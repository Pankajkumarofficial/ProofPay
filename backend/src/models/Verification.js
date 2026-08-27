import mongoose from 'mongoose';
import { VERDICT } from './constants.js';

/** One recorded judgement about whether a condition is satisfied. */
const verificationSchema = new mongoose.Schema(
  {
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', required: true, index: true },
    condition: { type: mongoose.Schema.Types.ObjectId, ref: 'Condition', required: true, index: true },
    evidence: { type: mongoose.Schema.Types.ObjectId, ref: 'Evidence', default: null },
    method: {
      type: String,
      enum: ['proof_engine', 'participant', 'manual'],
      default: 'proof_engine',
    },
    verdict: { type: String, enum: Object.values(VERDICT), required: true },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    explanation: { type: String, default: '' },
    contradictions: { type: [String], default: [] },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    engine: { type: String, default: 'proof-engine' },
    model: { type: String, default: null },
  },
  { timestamps: true }
);

verificationSchema.index({ condition: 1, createdAt: -1 });

export const Verification = mongoose.model('Verification', verificationSchema);
