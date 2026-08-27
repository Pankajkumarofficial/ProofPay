import mongoose from 'mongoose';
import { EVIDENCE_TYPE, EVIDENCE_STATUS } from './constants.js';

const evidenceSchema = new mongoose.Schema(
  {
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', required: true, index: true },
    condition: { type: mongoose.Schema.Types.ObjectId, ref: 'Condition', default: null, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    title: { type: String, default: '', maxlength: 160 },
    type: { type: String, enum: Object.values(EVIDENCE_TYPE), required: true },
    /** Where the proof came from: upload, link, integration name, or "note". */
    source: { type: String, default: 'upload', maxlength: 80 },

    fileUrl: { type: String, default: null },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: null },
    mimeType: { type: String, default: null },
    url: { type: String, default: null },
    note: { type: String, default: '', maxlength: 2000 },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: Object.values(EVIDENCE_STATUS),
      default: EVIDENCE_STATUS.SUBMITTED,
      index: true,
    },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    aiExplanation: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

evidenceSchema.index({ promise: 1, createdAt: -1 });

export const Evidence = mongoose.model('Evidence', evidenceSchema);
