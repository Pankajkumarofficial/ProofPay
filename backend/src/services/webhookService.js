import crypto from 'node:crypto';
import {
  Payment,
  PromiseModel,
  AuditLog,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  TERMINAL_PAYOUT_STATUS,
  AUDIT_ACTION,
} from '../models/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { recalculatePromise } from './proofEngine.js';
import { recordAudit } from './auditService.js';
import { publishUpdate } from './eventBus.js';
import { logger } from '../utils/logger.js';

/** What the payment provider tells us when nobody is looking. */

/** Razorpay signs the exact bytes it sent, so the raw body is what is verified. */
export function verifySignature(rawBody, signature) {
  const secret = env.payment.webhookSecret;
  if (!secret) throw ApiError.badRequest('No webhook secret is configured.');
  if (!signature) throw ApiError.unauthorized('This request carried no signature.');

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  // Constant time, so a wrong signature cannot be discovered a byte at a time.
  const expectedBuffer = Buffer.from(expected);
  const givenBuffer = Buffer.from(String(signature));
  const matches =
    expectedBuffer.length === givenBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, givenBuffer);

  if (!matches) throw ApiError.unauthorized('That signature does not match this body.');
}

/** Whether this event has been handled before. */
async function alreadyHandled(eventId) {
  if (!eventId) return false;
  const seen = await AuditLog.findOne({ 'metadata.webhookEventId': eventId }).select('_id').lean();
  return Boolean(seen);
}

/** Finds the payment an event is about, by the provider's own reference. */
async function paymentForEntity(entity) {
  const references = [entity?.order_id, entity?.id].filter(Boolean);
  if (!references.length) return null;
  return Payment.findOne({ providerReference: { $in: references } });
}

/* ── payment events ──────────────────────────────────────────────────────── */

async function onPaymentCaptured({ payment, entity, eventId }) {
  // The browser usually gets here first.
  if ([PAYMENT_STATUS.HELD, PAYMENT_STATUS.RELEASED].includes(payment.status)) {
    return { applied: false, reason: 'already held or released' };
  }

  payment.status = PAYMENT_STATUS.HELD;
  payment.fundedAt = payment.fundedAt ?? new Date();
  payment.metadata = { ...payment.metadata, capture: { id: entity?.id, via: 'webhook' } };
  await payment.save();

  return {
    applied: true,
    action: AUDIT_ACTION.PROMISE_FUNDED,
    summary: 'Payment captured — confirmed by the provider',
    eventId,
  };
}

async function onPaymentFailed({ payment, entity, eventId }) {
  // A failure never overrides money that is already held.
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    return { applied: false, reason: `payment is ${payment.status}` };
  }

  payment.status = PAYMENT_STATUS.FAILED;
  payment.metadata = {
    ...payment.metadata,
    failure: { code: entity?.error_code ?? null, description: entity?.error_description ?? null },
  };
  await payment.save();

  return {
    applied: true,
    action: AUDIT_ACTION.PROMISE_STATUS_CHANGED,
    summary: `Payment failed — ${entity?.error_description ?? 'the provider gave no reason'}`,
    eventId,
  };
}

/* ── payout events ───────────────────────────────────────────────────────── */

const PAYOUT_EVENT_STATUS = {
  'payout.processed': PAYOUT_STATUS.PROCESSED,
  'payout.reversed': PAYOUT_STATUS.REVERSED,
  'payout.failed': PAYOUT_STATUS.FAILED,
  'payout.rejected': PAYOUT_STATUS.REJECTED,
  'payout.queued': PAYOUT_STATUS.QUEUED,
  'payout.initiated': PAYOUT_STATUS.PROCESSING,
};

async function onPayoutEvent({ payment, entity, event, eventId }) {
  const next = PAYOUT_EVENT_STATUS[event];
  if (!next) return { applied: false, reason: `unhandled payout event ${event}` };

  // A payout that has already finished does not start again.
  if (TERMINAL_PAYOUT_STATUS.includes(payment.payout?.status)) {
    return { applied: false, reason: `payout is already ${payment.payout.status}` };
  }

  payment.payout = {
    ...(payment.payout?.toObject?.() ?? payment.payout ?? {}),
    status: next,
    reference: entity?.id ?? payment.payout?.reference ?? null,
    // The provider saying so is a stronger claim than a payer reporting it.
    verification: next === PAYOUT_STATUS.PROCESSED ? 'provider-confirmed' : payment.payout?.verification,
    failureReason:
      next === PAYOUT_STATUS.PROCESSED ? null : (entity?.failure_reason ?? entity?.status_details?.description ?? null),
    settledAt: next === PAYOUT_STATUS.PROCESSED ? new Date() : (payment.payout?.settledAt ?? null),
  };
  await payment.save();

  return {
    applied: true,
    action: next === PAYOUT_STATUS.PROCESSED ? AUDIT_ACTION.PROMISE_FULFILLED : AUDIT_ACTION.PROMISE_STATUS_CHANGED,
    summary: `Payout ${next} — reported by the provider`,
    eventId,
  };
}

/* ── entry point ─────────────────────────────────────────────────────────── */

const HANDLERS = {
  'payment.captured': onPaymentCaptured,
  'payment.failed': onPaymentFailed,
};

/** Applies one verified event. */
export async function applyWebhookEvent({ event, payload, eventId }) {
  const entity = payload?.payment?.entity ?? payload?.payout?.entity ?? null;

  if (await alreadyHandled(eventId)) {
    return { handled: false, reason: 'already applied' };
  }

  const payment = await paymentForEntity(entity);
  if (!payment) {
    logger.warn(`Webhook ${event} referenced a payment ProofPay does not have.`);
    return { handled: false, reason: 'no matching payment' };
  }

  const handler = event.startsWith('payout.') ? onPayoutEvent : HANDLERS[event];
  if (!handler) return { handled: false, reason: `unhandled event ${event}` };

  const outcome = await handler({ payment, entity, event, eventId });
  if (!outcome.applied) return { handled: false, reason: outcome.reason };

  const promise = await PromiseModel.findById(payment.promise);
  if (promise) {
    await recordAudit({
      promise,
      action: outcome.action,
      summary: outcome.summary,
      // What makes the next delivery of this event a no-op.
      metadata: { webhookEventId: eventId, event, provider: payment.provider },
    });

    const result = await recalculatePromise(promise._id, { reason: `webhook ${event}` });
    publishUpdate({
      userIds: [String(promise.payer), String(promise.recipient?.user ?? '')].filter(Boolean),
      type: 'promise.updated',
      data: { promiseId: String(promise._id), status: result?.promise?.status },
    });
  }

  logger.info(`Webhook ${event} applied to payment ${payment._id}.`);
  return { handled: true, event };
}
