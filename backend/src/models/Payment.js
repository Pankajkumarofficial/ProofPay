import mongoose from 'mongoose';
import { PAYMENT_STATUS, PAYOUT_STATUS, CURRENCIES } from './constants.js';

/**
 * The disbursement leg. RELEASED means a person authorised the money to move;
 * it does not mean the recipient has it. This sub-document carries that truth,
 * because a payout can sit queued for minutes and still fail afterwards.
 */
const payoutSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    /** Named on the record so a simulated payout can never read as a real one. */
    provider: { type: String, enum: ['razorpayx', 'simulated', 'upi-intent', null], default: null },
    /**
     * How much the UTR is actually worth as evidence. 'provider-confirmed' means
     * a payout API reported it; 'format-checked' means the payer typed a
     * well-formed reference we could not confirm with a bank. Never conflated.
     */
    verification: { type: String, enum: ['provider-confirmed', 'format-checked', null], default: null },
    status: { type: String, enum: Object.values(PAYOUT_STATUS), default: PAYOUT_STATUS.NOT_SENT },
    mode: { type: String, default: null },
    /** The bank's reference once money actually lands. */
    utr: { type: String, default: null },
    destinationLabel: { type: String, default: null },
    /** The NPCI deep link the payer settles with, for upi-intent only. */
    link: { type: String, default: null },
    failureReason: { type: String, default: null },
    initiatedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', required: true, index: true },
    payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipient: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      name: { type: String, required: true },
      email: { type: String, default: null },
    },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: CURRENCIES, default: 'INR' },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    provider: { type: String, enum: ['demo', 'razorpay'], default: 'demo' },
    providerReference: { type: String, default: null },
    providerOrderId: { type: String, default: null },
    /** Recorded so a release can always be traced back to a human decision. */
    authorisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    fundedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    payout: { type: payoutSchema, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Payment = mongoose.model('Payment', paymentSchema);
