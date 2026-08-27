import mongoose from 'mongoose';
import { DISPUTE_STATUS } from './constants.js';
import { publicId } from '../utils/ids.js';

const claimSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' },
    statement: { type: String, required: true, maxlength: 2000 },
    evidence: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Evidence' }],
  },
  { timestamps: true }
);

const disputeSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, index: true, default: () => publicId('CTS') },
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', required: true, index: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, maxlength: 2000 },
    contestedConditions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Condition' }],
    status: {
      type: String,
      enum: Object.values(DISPUTE_STATUS),
      default: DISPUTE_STATUS.OPEN,
      index: true,
    },
    claims: { type: [claimSchema], default: [] },
    /** Most recent Proof Engine reading of the contest. */
    analysis: {
      summary: { type: String, default: '' },
      fulfilledConditions: { type: [String], default: [] },
      contestedConditions: { type: [String], default: [] },
      missingProof: { type: [String], default: [] },
      contradictions: { type: [String], default: [] },
      recommendation: { type: String, default: '' },
      recommendedOutcome: {
        type: String,
        enum: ['release_full', 'release_partial', 'hold', 'refund', 'needs_more_proof', null],
        default: null,
      },
      confidence: { type: Number, min: 0, max: 100, default: 0 },
      analysedAt: { type: Date, default: null },
      engine: { type: String, default: null },
    },
    resolution: {
      outcome: {
        type: String,
        enum: ['released', 'refunded', 'partially_released', 'withdrawn', 'dismissed', null],
        default: null,
      },
      note: { type: String, default: '' },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      resolvedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

export const Dispute = mongoose.model('Dispute', disputeSchema);
