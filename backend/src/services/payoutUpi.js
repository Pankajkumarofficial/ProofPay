import { PAYOUT_STATUS } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { validateUtr } from '../utils/utr.js';

/**
 * Settlement over UPI, without holding anyone's money.
 *
 * Custodial escrow — taking the payer's funds in and paying them out later —
 * needs a payment aggregator licence in India. ProofPay does not have one and
 * does not pretend to: it decides *when* money should move and proves *why*,
 * then hands the payer a pre-filled payment their own bank app executes.
 *
 * So this provider sends nothing. It produces an NPCI deep link, waits for the
 * payer to pay from their own account, and settles only against a reference
 * that survives validation. The money is real; the custody never was ours.
 */

/** NPCI UPI deep link. Opening it pre-fills the payer's app; they still approve. */
export function buildUpiLink({ vpa, payeeName, amount, reference, note }) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: Number(amount).toFixed(2),
    cu: 'INR',
    tn: note,
    tr: reference,
  });
  return `upi://pay?${params.toString()}`;
}

export function createDestination({ method, details }) {
  if (method !== 'upi') {
    throw ApiError.badRequest(
      'Settling over UPI needs a UPI ID. A bank account can only be paid through a licensed payout provider.'
    );
  }
  return {
    method: 'upi',
    label: details.vpa,
    // No provider holds this — the ids exist so the shape matches other rails.
    contactId: null,
    fundAccountId: `upi:${details.vpa}`,
    addedAt: new Date(),
  };
}

/**
 * Opens the payment rather than sending it. Status is PENDING because that is
 * the truth: the payer has authorised the release, and nothing has moved yet.
 */
export function sendPayout({ payment, promise, destination }) {
  return {
    id: `upi_${promise.publicId}`,
    provider: 'upi-intent',
    status: PAYOUT_STATUS.PENDING,
    mode: 'UPI',
    destinationLabel: destination.label,
    utr: null,
    failureReason: null,
    initiatedAt: new Date(),
    completedAt: null,
    link: buildUpiLink({
      vpa: destination.label,
      payeeName: promise.recipient.name,
      amount: payment.amount,
      reference: promise.publicId,
      note: `ProofPay ${promise.publicId}`,
    }),
  };
}

/**
 * Settles against a reference the payer read off their bank app.
 *
 * A rejected reference leaves the payout exactly where it was — pending, not
 * failed — because a mistyped number says nothing about whether the transfer
 * happened.
 */
export function confirmPayout({ payout, utr }) {
  const result = validateUtr(utr, { authorisedAt: payout.initiatedAt ?? new Date() });
  if (!result.valid) throw ApiError.badRequest(result.reason);

  return {
    ...payout,
    status: PAYOUT_STATUS.PROCESSED,
    utr: result.utr,
    // Recorded so the interface never implies a bank confirmed this, and says
    // plainly when it could not even place the reference against the payment.
    verification: result.verification,
    verificationNote: result.note ?? null,
    failureReason: null,
    completedAt: new Date(),
  };
}

/** A pending UPI payment settles only when a person supplies a reference. */
export const refreshPayout = (payout) => payout;
