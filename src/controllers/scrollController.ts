import { Request, Response } from 'express';
import Scroll from '../models/Scroll';
import Document from '../models/Document';
import s3Client from '../config/s3Client';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../config/pgDb';
import * as pipelineService from '../services/pipelineService';
import fs from 'fs';

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'kamivault-storage';

const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')           // Replace spaces with _
    .replace(/[^\w-]+/g, '')       // Remove all non-word chars
    .replace(/--+/g, '_');          // Replace multiple - with single _
};

export const createScroll = async (req: any, res: Response) => {
  const { name, department } = req.body;
  const owner = req.user.id;

  try {
    const pgTableName = `scroll_${slugify(name)}_${Date.now().toString().slice(-4)}`;
    const s3Prefix = `${owner}/${slugify(name)}/`;
    
    // 1. Create S3 "folder" placeholder
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${s3Prefix}.keep`,
      Body: '',
    }));

    // 2. Create Dynamic PostgreSQL Table
    // Basic structure: id, document_id (ref to Mongo Document ID), raw_text, status, and system timestamps
    // We'll add dynamic columns later when the template is defined
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${pgTableName} (
        id SERIAL PRIMARY KEY,
        document_id VARCHAR(50) NOT NULL,
        raw_text TEXT,
        confidence_score DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(createTableQuery);

    // 3. Create Scroll in MongoDB
    const scroll = await Scroll.create({
      name,
      department,
      owner,
      s3Prefix,
      pgTableName,
      status: 'draft',
      templateSchema: {}, // Initialize empty
    });

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/users/scrolls');
    }

    res.status(201).json(scroll);
  } catch (error: any) {
    console.error('Create Scroll Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const uploadAnchor = async (req: any, res: Response) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const scroll = await Scroll.findById(id);
    if (!scroll) {
      return res.status(404).json({ message: 'Scroll not found' });
    }

    // 1. Upload to S3/MinIO
    const s3Key = `${scroll.s3Prefix}anchors/${Date.now()}_${file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fs.createReadStream(file.path),
    }));

    // 2. Create Anchor Document Record
    const anchorDoc = await Document.create({
      scroll: id,
      name: file.originalname,
      s3Url: s3Key,
      status: 'done',
    });

    // 3. Send to Pipeline
    const pipelineResult = await pipelineService.processAnchor(file.path, file.originalname);
    
    if (!pipelineResult.success || !pipelineResult.results[0].success) {
        throw new Error('Pipeline failed to process anchor');
    }

    const extractedData = pipelineResult.results[0].data;
    const schema: Record<string, string> = {};
    
    // Map extracted keys to types (simple mapping for now, mostly TEXT)
    // We slugify keys to ensure valid SQL column names
    const slugifyKey = (k: string) => k.toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');

    for (const key of Object.keys(extractedData)) {
        schema[slugifyKey(key)] = 'text';
    }

    // 4. Update PG Table structure
    for (const colName of Object.keys(schema)) {
        await pool.query(`ALTER TABLE ${scroll.pgTableName} ADD COLUMN IF NOT EXISTS ${colName} TEXT;`);
    }

    // 5. Insert Anchor Data into PG
    if (Object.keys(extractedData).length > 0) {
        const columns = Object.keys(extractedData).filter(k => schema[slugifyKey(k)]);
        const values = columns.map(col => extractedData[col]);
        
        if (columns.length > 0) {
            const insertQuery = `
                INSERT INTO ${scroll.pgTableName} (document_id, raw_text, ${columns.map(k => slugifyKey(k)).join(', ')})
                VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(', ')})
                RETURNING id;
            `;
            const pgRes = await pool.query(insertQuery, [anchorDoc._id.toString(), JSON.stringify(extractedData), ...values]);
            anchorDoc.pgRowId = pgRes.rows[0].id.toString();
            anchorDoc.extractedData = extractedData;
        }
    }

    // 6. Update Scroll in Mongo
    scroll.templateSchema = schema;
    scroll.status = 'in_progress';
    scroll.anchorDocument = anchorDoc._id; // Link to anchor doc
    await scroll.save();
    await anchorDoc.save();

    // 7. Cleanup temp file
    fs.unlinkSync(file.path);

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect(`/users/scrolls/${id}`);
    }

    res.json({ success: true, schema, data: extractedData });
  } catch (error: any) {
    console.error('Upload Anchor Error:', error);
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(500).json({ message: error.message });
  }
};


export const uploadBatch = async (req: any, res: Response) => {
  const { id } = req.params;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({ message: 'No files uploaded' });
  }

  try {
    const scroll = await Scroll.findById(id);
    if (!scroll) {
      return res.status(404).json({ message: 'Scroll not found' });
    }

    // 1. Upload to S3/MinIO and register documents
    const docRecords = await Promise.all(files.map(async (file) => {
        const s3Key = `${scroll.s3Prefix}records/${Date.now()}_${file.originalname}`;
        
        // Push physical file to MinIO
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fs.createReadStream(file.path),
        }));

        // Register in MongoDB
        return Document.create({
            scroll: id,
            name: file.originalname,
            s3Url: s3Key, 
            status: 'queued',
        });
    }));

    // 2. Call Pipeline
    const filesToProcess = files.map(f => ({ path: f.path, originalname: f.originalname }));
    const instructions = `Extract data based on the provided schema. The scroll name is ${scroll.name}.`;
    const exampleJson = JSON.stringify(scroll.templateSchema);

    const pipelineResult = await pipelineService.processBatchFiles(filesToProcess, instructions, exampleJson);

    if (pipelineResult.success) {
        for (const result of pipelineResult.results) {
            const doc = docRecords.find(d => d.name === result.filename);
            if (!doc) continue;

            if (result.success) {
                // 3. Insert into PostgreSQL
                const data = result.data;
                const columns = Object.keys(data).filter(k => scroll.templateSchema[k]);
                const values = columns.map(col => data[col]);

                if (columns.length > 0) {
                    const insertQuery = `
                        INSERT INTO ${scroll.pgTableName} (document_id, raw_text, ${columns.join(', ')})
                        VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(', ')})
                        RETURNING id;
                    `;
                    const pgRes = await pool.query(insertQuery, [doc._id.toString(), JSON.stringify(data), ...values]);
                    
                    doc.pgRowId = pgRes.rows[0].id.toString();
                    doc.status = 'done';
                    doc.extractedData = data;
                } else {
                    doc.status = 'failed';
                }
            } else {
                doc.status = 'failed';
            }
            await doc.save();
        }
    }

    // 4. Cleanup
    files.forEach(f => fs.unlinkSync(f.path));

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect(`/users/scrolls/${id}`);
    }

    res.json({ success: true, processed: pipelineResult.processed });
  } catch (error: any) {
    console.error('Upload Batch Error:', error);
    files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    res.status(500).json({ message: error.message });
  }
};

export const completeScroll = async (req: any, res: Response) => {
  const { id } = req.params;

  try {
    const scroll = await Scroll.findById(id);
    if (!scroll) {
      return res.status(404).json({ message: 'Scroll not found' });
    }

    scroll.status = 'complete';
    await scroll.save();

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/users/vault');
    }

    res.json({ success: true, scroll });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteScroll = async (req: any, res: Response) => {
  const { id } = req.params;

  try {
    const scroll = await Scroll.findById(id);
    if (!scroll) {
      return res.status(404).json({ message: 'Scroll not found' });
    }

    // 1. Drop the dedicated PG table
    try {
      await pool.query(`DROP TABLE IF EXISTS ${scroll.pgTableName};`);
    } catch (pgErr) {
      console.warn('Could not drop PG table:', pgErr);
    }

    // 2. Delete all associated documents
    await Document.deleteMany({ scroll: id });

    // 3. Delete the Scroll from MongoDB
    await Scroll.findByIdAndDelete(id);

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.redirect('/users/scrolls');
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete Scroll Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getScrolls = async (req: any, res: Response) => {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;

    // Find scrolls where user is owner OR user is in sharedWith list
    const scrolls = await Scroll.find({
      $or: [
        { owner: userId },
        { 'sharedWith.email': userEmail }
      ]
    }).sort({ createdAt: -1 }).lean();

    const scrollsWithCounts = await Promise.all(scrolls.map(async (scroll: any) => {
      const [docCount, pgCount] = await Promise.all([
        Document.countDocuments({ scroll: scroll._id }),
        pool.query(`SELECT COUNT(*) FROM ${scroll.pgTableName}`).then((r: any) => r.rows[0].count).catch(() => 0),
      ]);
      return { 
        ...scroll, 
        docCount, 
        rowCount: pgCount,
        isOwner: scroll.owner.toString() === userId.toString()
      };
    }));

    return scrollsWithCounts;
  } catch (error) {
    console.error('Get Scrolls Error:', error);
    return [];
  }
};

export const shareScroll = async (req: any, res: Response) => {
  const { id } = req.params;
  const { email, role } = req.body;

  try {
    const scroll = await Scroll.findById(id);
    if (!scroll) return res.status(404).json({ message: 'Scroll not found' });

    // Only owner can share
    if (scroll.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Only the owner can share this scroll' });
    }

    // Check if already shared
    const existingIndex = scroll.sharedWith.findIndex(s => s.email === email.toLowerCase());
    if (existingIndex > -1) {
      scroll.sharedWith[existingIndex].role = role || 'viewer';
    } else {
      scroll.sharedWith.push({ email: email.toLowerCase(), role: role || 'viewer', addedAt: new Date() });
    }

    await scroll.save();
    res.redirect(`/users/scrolls/${id}`);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const revokeAccess = async (req: any, res: Response) => {
  const { id } = req.params;
  const { email } = req.body;

  try {
    const scroll = await Scroll.findById(id);
    if (!scroll) return res.status(404).json({ message: 'Scroll not found' });

    // Only owner can revoke
    if (scroll.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Only the owner can manage access' });
    }

    scroll.sharedWith = scroll.sharedWith.filter(s => s.email !== email.toLowerCase());
    await scroll.save();
    res.redirect(`/users/scrolls/${id}`);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const toggleDocumentFlag = async (req: any, res: Response) => {
  const { id } = req.params;

  try {
    const doc = await Document.findById(id).populate('scroll');
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    // Access Check: Owner or Shared
    const scroll = doc.scroll as any;
    const isOwner = scroll.owner.toString() === req.user.id.toString();
    const isShared = scroll.sharedWith.some((s: any) => s.email.toLowerCase() === req.user.email.toLowerCase());

    if (!isOwner && !isShared) {
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/users/scrolls');
      }
      return res.status(403).json({ message: 'Not authorized to modify this document' });
    }

    doc.flaggedForReview = !doc.flaggedForReview;
    await doc.save();

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect(`/users/documents/${id}`);
    }

    res.json({ success: true, flagged: doc.flaggedForReview });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

