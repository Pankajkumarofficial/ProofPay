// @ts-check
import crypto from 'node:crypto';
import { PAYOUT_STATUS } from '../models/index.js';
import { env } from '../config/env.js';

/**
 * A payout rail that behaves like a real one without moving money.
 *
 * This exists because RazorpayX is business banking: it needs a registered
 * entity, KYC and an activated account, which is a long way to go to see what a
 * payout looks like. The simulator runs the same state machine the real rail
 * does — queued → processing → processed, with failures and reversals — so the
 * asynchronous behaviour that actually shapes the UI can be built and demoed
 * honestly.
 *
 * It is never presented as real. Every payout it produces carries
 * `provider: 'simulated'`, and the interface shows that on the record.
 */

/**
 * Destinations that force an outcome, the way a provider's test card numbers do.
 * Anything else settles normally.
 */
const OUTCOMES = [
  { match: /^fail@/i, bank: /0000$/, status: PAYOUT_STATUS.FAILED, reason: 'Simulated failure — the beneficiary bank declined this transfer.' },
  { match: /^reverse@/i, bank: /9999$/, status: PAYOUT_STATUS.REVERSED, reason: 'Simulated reversal — the bank returned the money after accepting it.' },
  { match: /^reject@/i, bank: /1111$/, status: PAYOUT_STATUS.REJECTED, reason: 'Simulated rejection — the provider refused this payout.' },
];

/** Which scripted outcome, if any, this destination asks for. */
function outcomeFor(destination) {
  const value = destination?.label ?? '';
  for (const outcome of OUTCOMES) {
    const matches = destination?.method === 'upi' ? outcome.match.test(value) : outcome.bank.test(value);
    if (matches) return outcome;
  }
  return null;
}

const simId = (prefix) => `${prefix}_sim_${crypto.randomBytes(7).toString('hex')}`;

/** Registers a destination without a network call, in the shape the real one returns. */
export function createDestination({ method, details }) {
  return {
    method,
    label:
      method === 'upi'
        ? details.vpa
        : `${details.ifsc.slice(0, 4)} ····${String(details.accountNumber).slice(-4)}`,
    contactId: simId('cont'),
    fundAccountId: simId('fa'),
    addedAt: new Date(),
  };
}

/**
 * Opens a payout. Like the real rail this returns immediately in a non-final
 * state — the money has not arrived yet, and the caller must not pretend it has.
 */
export function sendPayout({ payment, destination }) {
  const outcome = outcomeFor(destination);

  // A rejection is decided up front; the rest of the rail takes time.
  if (outcome?.status === PAYOUT_STATUS.REJECTED) {
    return {
      id: simId('pout'),
      provider: 'simulated',
      status: PAYOUT_STATUS.REJECTED,
      mode: destination.method === 'upi' ? 'UPI' : env.payout.mode,
      destinationLabel: destination.label,
      failureReason: outcome.reason,
      initiatedAt: new Date(),
    };
  }

  return {
    id: simId('pout'),
    provider: 'simulated',
    status: PAYOUT_STATUS.QUEUED,
    mode: destination.method === 'upi' ? 'UPI' : env.payout.mode,
    destinationLabel: destination.label,
    failureReason: null,
    initiatedAt: new Date(),
    completedAt: null,
    amount: payment.amount,
  };
}

/**
 * Advances a payout by elapsed time rather than a timer, so the state survives
 * a server restart and cannot drift out of sync with what was stored.
 */
export function refreshPayout(payout, destination) {
  if (!payout?.initiatedAt) return payout;

  const settleMs = env.payout.simulatedSettleMs;
  const elapsed = Date.now() - new Date(payout.initiatedAt).getTime();

  if (elapsed < settleMs * 0.35) return { ...payout, status: PAYOUT_STATUS.QUEUED };
  if (elapsed < settleMs) return { ...payout, status: PAYOUT_STATUS.PROCESSING };

  const outcome = outcomeFor(destination);
  if (outcome && outcome.status !== PAYOUT_STATUS.REJECTED) {
    return {
      ...payout,
      status: outcome.status,
      failureReason: outcome.reason,
      // A reversal was accepted first, so it still carries a bank reference.
      utr: outcome.status === PAYOUT_STATUS.REVERSED ? payout.utr ?? simulatedUtr() : null,
      completedAt: new Date(),
    };
  }

  return {
    ...payout,
    status: PAYOUT_STATUS.PROCESSED,
    utr: payout.utr ?? simulatedUtr(),
    failureReason: null,
    completedAt: payout.completedAt ?? new Date(),
  };
}

/** Shaped like a real UTR so the UI is exercised the same way. */
const simulatedUtr = () =>
  `SIM${crypto.randomBytes(5).toString('hex').toUpperCase()}`.slice(0, 16);