import { Request, Response } from 'express';
import Scroll from '../models/Scroll';

export const getProfile = (req: any, res: Response) => {
  res.json({
    message: 'Welcome to your profile',
    user: req.user,
  });
};

export const renderProfile = (req: any, res: Response) => {
  res.render('profile', { title: 'Profile', user: req.user });
};

export const renderDashboard = async (req: any, res: Response) => {
  try {
    const scrolls = await Scroll.find({ owner: req.user._id });
    const scrollIds = scrolls.map(s => s._id);
    
    const docCount = await Document.countDocuments({ scroll: { $in: scrollIds } });
    
    // Calculate average confidence score
    const docs = await Document.find({ scroll: { $in: scrollIds }, confidenceScore: { $gt: 0 } });
    const avgConfidence = docs.length > 0 
      ? (docs.reduce((acc, doc) => acc + (doc.confidenceScore || 0), 0) / docs.length).toFixed(1)
      : '99.9'; // Fallback to 99.9 if no docs with confidence yet

    // Fetch latest 5 documents
    const recentDocs = await Document.find({ scroll: { $in: scrollIds } })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('scroll');

    res.render('dashboard', { 
      title: 'Dashboard', 
      user: req.user,
      stats: {
        vaultCount: scrolls.length,
        recordCount: docCount,
        integrity: avgConfidence
      },
      recentDocs
    });
  } catch (error) {
    res.status(500).render('dashboard', { 
      title: 'Dashboard', 
      user: req.user,
      stats: { vaultCount: 0, recordCount: 0, integrity: '0' }
    });
  }
};

import { getScrolls } from './scrollController';

export const renderScrolls = async (req: any, res: Response) => {
  const scrolls = await getScrolls(req, res);
  res.render('scrolls', { title: 'Scrolls', user: req.user, scrolls });
};

export const renderVault = async (req: any, res: Response) => {
  const scrolls = await getScrolls(req, res);
  res.render('vault', { title: 'Vault', user: req.user, scrolls });
};

export const renderSettings = (req: any, res: Response) => {
  res.render('settings', { title: 'Settings', user: req.user });
};

export const renderHowItWorks = (req: any, res: Response) => {
  res.render('how-it-works', { title: 'How It Works', user: req.user });
};

import Document from '../models/Document';

export const renderManageScroll = async (req: any, res: Response) => {
  try {
    const scroll = await Scroll.findById(req.params.id);
    if (!scroll) {
      return res.status(404).render('404', { title: 'Not Found' });
    }

    // Access Check: Owner or Shared
    const isOwner = scroll.owner.toString() === req.user.id.toString();
    const isShared = scroll.sharedWith.some(s => s.email.toLowerCase() === req.user.email.toLowerCase());

    if (!isOwner && !isShared) {
      return res.redirect('/users/scrolls');
    }

    const documents = await Document.find({ scroll: scroll._id }).sort({ createdAt: -1 });
    res.render('manageScroll', { 
      title: `Manage - ${scroll.name}`, 
      user: req.user, 
      scroll, 
      documents,
      isOwner // Pass to view to restrict sharing UI
    });
  } catch (error) {
    res.status(500).redirect('/users/scrolls');
  }
};

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import s3Client from '../config/s3Client';

export const renderDocumentDetail = async (req: any, res: Response) => {
  try {
    const doc = await Document.findById(req.params.id).populate('scroll');
    if (!doc) {
      return res.status(404).render('404', { title: 'Not Found' });
    }

    // Generate Pre-signed URL for MinIO/S3
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: doc.s3Url,
    });
    
    // URL expires in 1 hour (3600 seconds)
    const viewUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.render('documentDetail', { 
      title: `Ref: ${doc.name}`, 
      user: req.user, 
      doc,
      viewUrl 
    });
  } catch (error) {
    console.error('Render Document Detail Error:', error);
    res.status(500).redirect('/users/dashboard');
  }
};

import { pool } from '../config/pgDb';

export const renderScrollData = async (req: any, res: Response) => {
  try {
    const scroll = await Scroll.findById(req.params.id);
    if (!scroll) {
      return res.status(404).render('404', { title: 'Not Found' });
    }

    // Fetch all records from the dynamic PG table
    const result = await pool.query(`SELECT * FROM ${scroll.pgTableName} ORDER BY created_at DESC`);
    const records = result.rows;

    res.render('scrollData', { 
        title: `${scroll.name} - Data`, 
        user: req.user, 
        scroll, 
        records 
    });
  } catch (error) {
    console.error('Render Scroll Data Error:', error);
    res.status(500).redirect('/users/vault');
  }
};

export const renderHome = (req: Request, res: Response) => {
  res.render('index', { title: 'Home' });
};
