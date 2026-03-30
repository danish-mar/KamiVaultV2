import mongoose, { Document, Schema } from 'mongoose';

export interface IScroll extends Document {
  name: string;
  department: 'Land' | 'Health' | 'Municipal' | 'Revenue' | 'Education';
  owner: mongoose.Types.ObjectId;
  s3Prefix: string;
  status: 'draft' | 'in_progress' | 'complete';
  sharedWith: { email: string; role: 'viewer' | 'editor' | 'admin'; addedAt: Date }[];
  anchorDocument?: mongoose.Types.ObjectId;
  templateSchema: Record<string, string>; // e.g. { "name": "string", "date": "date" }
  pgTableName: string;
  createdAt: Date;
}

const ScrollSchema: Schema = new Schema({
  name: { type: String, required: true },
  department: { 
    type: String, 
    enum: ['Land', 'Health', 'Municipal', 'Revenue', 'Education'], 
    required: true 
  },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  s3Prefix: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['draft', 'in_progress', 'complete'], 
    default: 'draft' 
  },
  anchorDocument: { type: Schema.Types.ObjectId, ref: 'Document' },
  sharedWith: [{
    email: { type: String, lowercase: true, trim: true },
    role: { type: String, enum: ['viewer', 'editor', 'admin'], default: 'viewer' },
    addedAt: { type: Date, default: Date.now }
  }],
  templateSchema: { type: Object, default: {} },
  pgTableName: { type: String, required: true },
}, {
  timestamps: true,
});

export default mongoose.model<IScroll>('Scroll', ScrollSchema);
