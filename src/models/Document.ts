import mongoose, { Document, Schema } from 'mongoose';

export interface IDocument extends Document {
  scroll: mongoose.Types.ObjectId;
  name: string;
  s3Url: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  confidenceScore: number;
  flaggedForReview: boolean;
  pgRowId?: string;
  extractedData: Record<string, any>;
  createdAt: Date;
}

const DocumentSchema: Schema = new Schema({
  scroll: { type: Schema.Types.ObjectId, ref: 'Scroll', required: true },
  name: { type: String, required: true },
  s3Url: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['queued', 'processing', 'done', 'failed'], 
    default: 'queued' 
  },
  confidenceScore: { type: Number, default: 0 },
  flaggedForReview: { type: Boolean, default: false },
  pgRowId: { type: String },
  extractedData: { type: Object, default: {} },
}, {
  timestamps: true,
});

export default mongoose.model<IDocument>('Document', DocumentSchema);
