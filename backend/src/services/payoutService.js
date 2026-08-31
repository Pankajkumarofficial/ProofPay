import crypto from 'node:crypto';
import { PAYOUT_STATUS, TERMINAL_PAYOUT_STATUS } from '../models/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import * as simulator from './payoutSimulator.js';
import * as upi from './payoutUpi.js';

/**
 * Payouts — the last mile.
 *
 * Capturing a payment moves money as far as the platform's own account.
 * This module carries it to the recipient's bank or UPI handle through
 * RazorpayX, which is a separate product with its own activation and KYC.
 *
 * Two properties matter more than the API calls:
 *
 *  1. ProofPay never stores an account number. Details go straight to the
 *     provider, which returns opaque ids; only those ids and a masked label
 *     are kept.
 *  2. A payout is asynchronous. It can sit queued for minutes and fail after a
 *     release was authorised, so its state is reported separately and never
 *     collapsed into "released".
 */

const API = 'https://api.razorpay.com/v1';

const authHeader = () =>
  'Basic ' + Buffer.from(`${env.payout.keyId}:${env.payout.keySecret}`).toString('base64');

export const payoutsConfigured = () => env.payout.configured;

/** Which rail is carrying payouts, or null when the last mile is switched off. */
export function activePayoutProvider() {
  if (!env.payout.enabled) return null;
  if (env.payout.provider === 'simulated') return 'simulated';
  if (env.payout.provider === 'upi-intent') return 'upi-intent';
  return env.payout.configured ? 'razorpayx' : null;
}

const isSimulated = () => activePayoutProvider() === 'simulated';
const isUpiIntent = () => activePayoutProvider() === 'upi-intent';

async function xRequest(path, { method = 'POST', body, idempotencyKey } = {}) {
  const headers = { Authorization: authHeader(), 'Content-Type': 'application/json' };
  // Mandatory on payout creation since March 2025, and the reason a retry after
  // a timeout cannot pay someone twice.
  if (idempotencyKey) headers['X-Payout-Idempotency'] = idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const description = payload?.error?.description ?? 'The payout provider could not be reached.';
    // Razorpay answers an un-activated RazorpayX with a generic "URL was not
    // found", which reads like a bug in this code rather than a missing
    // product. Naming the real cause here saves a long debugging detour.
    if (/not available|not enabled|unauthorized|not found on the server/i.test(description)) {
      throw ApiError.unavailable(
        'RazorpayX is not activated on this Razorpay account, so no payout could be sent. ' +
          'The release is still recorded and the money is accounted for — activate RazorpayX ' +
          '(signup, KYC, a funded account and IP allowlisting), then retry the payout.'
      );
    }
    throw ApiError.unavailable(description);
  }
  return payload;
}

/** Last four digits only — enough for a person to recognise, useless if leaked. */
const maskAccount = (value) => `····${String(value).slice(-4)}`;

/**
 * Registers where a recipient should be paid. The raw details pass through to
 * the provider and are not returned, logged, or persisted by ProofPay.
 */
export async function createDestination({ promise, method, details }) {
  if (!activePayoutProvider()) {
    throw ApiError.unavailable('Payouts are not configured on this server.');
  }
  if (isUpiIntent()) return upi.createDestination({ method, details });
  if (isSimulated()) return simulator.createDestination({ method, details });

  const contact = await xRequest('/contacts', {
    body: {
      name: promise.recipient.name,
      email: promise.recipient.email || undefined,
      type: 'vendor',
      reference_id: promise.publicId,
    },
  });

  const fundAccountBody =
    method === 'upi'
      ? { contact_id: contact.id, account_type: 'vpa', vpa: { address: details.vpa } }
      : {
          contact_id: contact.id,
          account_type: 'bank_account',
          bank_account: {
            name: details.accountHolder,
            ifsc: details.ifsc,
            account_number: details.accountNumber,
          },
        };

  const fundAccount = await xRequest('/fund_accounts', { body: fundAccountBody });

  return {
    method,
    label: method === 'upi' ? details.vpa : `${details.ifsc.slice(0, 4)} ${maskAccount(details.accountNumber)}`,
    contactId: contact.id,
    fundAccountId: fundAccount.id,
    addedAt: new Date(),
  };
}

/**
 * Sends held money to the recipient. Called only after a person has authorised
 * the release — this function never decides that anything is owed.
 *
 * Failure here is deliberately not fatal to the release: the promise stays
 * fulfilled and the payout carries the error, because the payer's decision was
 * valid even when the bank rail was not.
 */
export async function sendPayout({ payment, promise }) {
  const destination = promise.recipient?.payoutDestination;
  if (!activePayoutProvider() || !destination?.fundAccountId) {
    return {
      status: PAYOUT_STATUS.NOT_SENT,
      destinationLabel: destination?.label ?? null,
      failureReason: activePayoutProvider() ? 'No payout destination on file.' : null,
    };
  }

  if (isUpiIntent()) return upi.sendPayout({ payment, promise, destination });
  if (isSimulated()) return simulator.sendPayout({ payment, destination });

  try {
    const payout = await xRequest('/payouts', {
      // Keyed to the payment, so a retried release settles once.
      idempotencyKey: `proofpay-payout-${payment._id}`,
      body: {
        account_number: env.payout.accountNumber,
        fund_account_id: destination.fundAccountId,
        amount: Math.round(payment.amount * 100),
        currency: payment.currency,
        mode: destination.method === 'upi' ? 'UPI' : env.payout.mode,
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: promise.publicId,
        narration: `ProofPay ${promise.publicId}`.slice(0, 30),
      },
    });

    return {
      id: payout.id,
      status: payout.status ?? PAYOUT_STATUS.QUEUED,
      mode: payout.mode ?? null,
      utr: payout.utr ?? null,
      provider: 'razorpayx',
      destinationLabel: destination.label,
      failureReason: payout.failure_reason ?? null,
      initiatedAt: new Date(),
      completedAt: payout.status === PAYOUT_STATUS.PROCESSED ? new Date() : null,
    };
  } catch (error) {
    logger.warn(`Payout failed for ${promise.publicId}: ${error.message}`);
    return {
      provider: 'razorpayx',
      status: PAYOUT_STATUS.FAILED,
      destinationLabel: destination.label,
      failureReason: error.message,
      initiatedAt: new Date(),
    };
  }
}

/** Re-reads a payout that is still in flight. Terminal states are left alone. */
export async function refreshPayout(payment, promise) {
  const current = payment.payout?.toObject?.() ?? payment.payout ?? {};
  if (!current.id || TERMINAL_PAYOUT_STATUS.includes(current.status)) return current;
  if (!activePayoutProvider()) return current;

  if (current.provider === 'upi-intent') return upi.refreshPayout(current);
  if (current.provider === 'simulated') {
    return simulator.refreshPayout(current, promise?.recipient?.payoutDestination);
  }

  try {
    const payout = await xRequest(`/payouts/${current.id}`, { method: 'GET' });
    return {
      ...current,
      status: payout.status ?? current.status,
      utr: payout.utr ?? current.utr,
      mode: payout.mode ?? current.mode,
      failureReason: payout.failure_reason ?? current.failureReason,
      completedAt: payout.status === PAYOUT_STATUS.PROCESSED ? new Date() : current.completedAt,
    };
  } catch (error) {
    logger.warn(`Could not refresh payout ${current.id}: ${error.message}`);
    return current;
  }
}

/**
 * Whether the money is known to have reached the recipient.
 *
 * This is the line between SETTLING and FULFILLED. A release is the payer's
 * decision and it stands on its own; fulfilment is the separate, slower fact
 * that the transfer happened — a UTR read off a bank app, or a provider
 * reporting `processed`. Until then the promise says so.
 *
 * NOT_SENT with no failure recorded is the one case that settles without a
 * transfer: no rail was configured, so the release is all the settlement there
 * is. NOT_SENT *with* a reason — no destination on file — is a payout that
 * still has to happen.
 */
export function payoutSettled(payout) {
  const current = payout?.toObject?.() ?? payout ?? {};
  if (current.status === PAYOUT_STATUS.PROCESSED) return true;
  return current.status === PAYOUT_STATUS.NOT_SENT && !current.failureReason;
}

/**
 * A person-facing sentence for whatever state the payout is in.
 *
 * Written in the third person, because this one travels: it goes into
 * notifications that reach both sides of a promise, and only the payer pays.
 * Telling the recipient "waiting for you to pay" is telling them something
 * untrue about their own promise. The interface writes its own second-person
 * version for whoever is actually reading it.
 */
export function describePayout(payout = {}) {
  switch (payout.status) {
    case PAYOUT_STATUS.PROCESSED: {
      const who = payout.destinationLabel ?? 'the recipient';
      if (!payout.utr) return `Paid to ${who}`;
      // The grade travels with the sentence: neither of these is a bank saying so.
      const grade =
        payout.verification === 'format-checked'
          ? ' · reported by the payer'
          : payout.verification === 'payer-reported'
            ? ' · reported by the payer, not date-checked'
            : '';
      return `Paid to ${who} · UTR ${payout.utr}${grade}`;
    }
    case PAYOUT_STATUS.QUEUED:
      return 'Queued — it will send when the balance covers it.';
    case PAYOUT_STATUS.PENDING:
      return payout.provider === 'upi-intent'
        ? 'Waiting for the payer to pay and record the UTR from their bank app.'
        : 'On its way to the recipient’s account.';
    case PAYOUT_STATUS.PROCESSING:
      return 'On its way to the recipient’s account.';
    case PAYOUT_STATUS.REVERSED:
      return 'The bank returned this payout. The money is back in the platform account.';
    case PAYOUT_STATUS.CANCELLED:
      return 'This payout was cancelled before it sent.';
    case PAYOUT_STATUS.REJECTED:
      return 'The provider rejected this payout.';
    case PAYOUT_STATUS.FAILED:
      return payout.failureReason ?? 'This payout did not go through.';
    default:
      return 'Released. No payout was sent — this promise settled inside ProofPay.';
  }
}

/** Idempotency keys are derived, never random, so a retry is provably the same request. */
export const payoutKeyFor = (paymentId) =>
  crypto.createHash('sha256').update(`proofpay-payout-${paymentId}`).digest('hex').slice(0, 32);

/** Settles a UPI payment the payer made themselves, against a real reference. */
export function confirmUpiPayout({ payment, utr }) {
  const current = payment.payout?.toObject?.() ?? payment.payout ?? {};
  if (current.provider !== 'upi-intent') {
    throw ApiError.badRequest('This payout is not settled by hand — it is carried by a provider.');
  }
  if (current.status === PAYOUT_STATUS.PROCESSED) {
    throw ApiError.conflict('This payout has already been settled.');
  }
  return upi.confirmPayout({ payout: current, utr });
}
