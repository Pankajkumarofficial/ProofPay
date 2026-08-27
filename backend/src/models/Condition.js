import mongoose from 'mongoose';
import { CONDITION_STATUS, CONDITION_TYPE, VERIFICATION_METHOD } from './constants.js';

const conditionSchema = new mongoose.Schema(
  {
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', required: true, index: true },
    order: { type: Number, default: 0 },
    label: { type: String, default: '' },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    type: {
      type: String,
      enum: Object.values(CONDITION_TYPE),
      default: CONDITION_TYPE.DELIVERABLE,
    },
    verificationMethod: {
      type: String,
      enum: Object.values(VERIFICATION_METHOD),
      default: VERIFICATION_METHOD.AI_ASSESSMENT,
    },
    requiredEvidence: { type: [String], default: [] },
    status: {
      type: String,
      enum: Object.values(CONDITION_STATUS),
      default: CONDITION_STATUS.PENDING,
      index: true,
    },
    /** 0–100. Derived from the validations recorded against this condition. */
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    /** Relative importance when scoring the promise. */
    weight: { type: Number, min: 0.1, max: 5, default: 1 },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

conditionSchema.index({ promise: 1, order: 1 });

export const Condition = mongoose.model('Condition', conditionSchema);
