import mongoose, { Document, Schema } from 'mongoose';

export interface IDownloadSession extends Document {
  sessionId: string;
  url: string;
  quality: string;
  status: 'downloading' | 'completed' | 'error';
  progress: number;
  error?: string;
  tempFile?: string;
  contentType: string;
  filename: string;
  createdAt: Date;
  updatedAt: Date;
}

const DownloadSessionSchema = new Schema<IDownloadSession>({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  url: {
    type: String,
    required: true
  },
  quality: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['downloading', 'completed', 'error'],
    default: 'downloading'
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  error: {
    type: String,
    required: false
  },
  tempFile: {
    type: String,
    required: false
  },
  contentType: {
    type: String,
    required: true
  },
  filename: {
    type: String,
    required: true
  }
}, {
  timestamps: true,
  // Auto-delete old sessions after 24 hours
  expires: 86400 // 24 hours in seconds
});

// Index for efficient queries
DownloadSessionSchema.index({ sessionId: 1 });
DownloadSessionSchema.index({ status: 1 });
DownloadSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.models.DownloadSession || mongoose.model<IDownloadSession>('DownloadSession', DownloadSessionSchema);