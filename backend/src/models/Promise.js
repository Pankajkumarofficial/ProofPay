import mongoose from 'mongoose';
import { publicId } from '../utils/ids.js';
import { PROMISE_STATUS, CURRENCIES } from './constants.js';

/**
 * Where a payout should land.
 *
 * Deliberately holds no account number, IFSC or UPI address. Those go straight
 * to the payment provider, which returns opaque ids; ProofPay keeps only those
 * ids and a masked label to show a person. A dump of this collection therefore
 * exposes nobody's bank details.
 */
const payoutDestinationSchema = new mongoose.Schema(
  {
    method: { type: String, enum: ['bank', 'upi'], default: null },
    /** Safe to display: "HDFC ····4321" or "name@bank". Never the full value. */
    label: { type: String, default: null, maxlength: 120 },
    contactId: { type: String, default: null },
    fundAccountId: { type: String, default: null },
    addedAt: { type: Date, default: null },
  },
  { _id: false }
);

/** A counterparty who may or may not have a ProofPay account yet. */
const partySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, lowercase: true, trim: true, default: null },
    role: { type: String, enum: ['payer', 'recipient', 'witness'], required: true },
    confirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },
    payoutDestination: { type: payoutDestinationSchema, default: () => ({}) },
  },
  { _id: false }
);

const healthSchema = new mongoose.Schema(
  {
    overall: { type: Number, min: 0, max: 100, default: 0 },
    conditions: { type: Number, min: 0, max: 100, default: 0 },
    evidence: { type: Number, min: 0, max: 100, default: 0 },
    timeline: { type: Number, min: 0, max: 100, default: 0 },
    verification: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

const promiseSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, index: true, default: () => publicId('PRM') },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: '', maxlength: 4000 },
    /** The raw sentence the payer typed; the Proof Engine's input of record. */
    sourceText: { type: String, default: '', maxlength: 4000 },
    purpose: { type: String, default: '', maxlength: 300 },
    outcome: { type: String, default: '', maxlength: 500 },

    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: CURRENCIES, default: 'INR' },

    payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipient: { type: partySchema, required: true },
    participants: { type: [partySchema], default: [] },

    status: {
      type: String,
      enum: Object.values(PROMISE_STATUS),
      default: PROMISE_STATUS.DRAFT,
      index: true,
    },
    deadline: { type: Date, default: null },

    proofConfidence: { type: Number, min: 0, max: 100, default: 0 },
    promiseHealth: { type: healthSchema, default: () => ({}) },

    fundedAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    /** Set while the payer still has to resolve Proof Engine ambiguity flags. */
    ambiguityFlags: {
      type: [
        new mongoose.Schema(
          {
            phrase: String,
            reason: String,
            suggestions: [String],
            resolved: { type: Boolean, default: false },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

promiseSchema.index({ payer: 1, status: 1, createdAt: -1 });
promiseSchema.index({ 'recipient.user': 1 });
promiseSchema.index({ 'recipient.email': 1 });
promiseSchema.index({ title: 'text', description: 'text', 'recipient.name': 'text' });

promiseSchema.virtual('conditions', {
  ref: 'Condition',
  localField: '_id',
  foreignField: 'promise',
});

promiseSchema.virtual('isOverdue').get(function isOverdue() {
  if (!this.deadline) return false;
  const settled = ['FULFILLED', 'CANCELLED', 'EXPIRED'];
  return !settled.includes(this.status) && this.deadline.getTime() < Date.now();
});

/**
 * Mongo filter matching every promise the given user may see: they either
 * created it, are the named recipient, or are listed as a participant.
 */
promiseSchema.statics.visibilityFilter = function visibilityFilter(user) {
  return {
    $or: [
      { payer: user._id },
      { 'recipient.user': user._id },
      { 'recipient.email': user.email },
      { 'participants.user': user._id },
      { 'participants.email': user.email },
    ],
  };
};

export const PromiseModel = mongoose.model('Promise', promiseSchema);
