import crypto from 'node:crypto';
import { Payment, PAYMENT_STATUS } from '../models/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** Payments. */

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const authHeader = () =>
  'Basic ' +
  Buffer.from(`${env.payment.razorpayKeyId}:${env.payment.razorpayKeySecret}`).toString('base64');

const razorpayConfigured = () =>
  Boolean(env.payment.razorpayKeyId && env.payment.razorpayKeySecret);

export function activeProvider() {
  if (env.payment.mode === 'razorpay') {
    if (!razorpayConfigured()) {
      logger.warn('PAYMENT_MODE=razorpay but no credentials are set — falling back to demo settlement.');
      return 'demo';
    }
    return 'razorpay';
  }
  return 'demo';
}

async function razorpayRequest(path, { method = 'POST', body } = {}) {
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw ApiError.unavailable(
      payload?.error?.description || 'The payment provider could not be reached. Your money has not moved.'
    );
  }
  return payload;
}

/** Opens a funding intent for a promise. */
export async function createPayment({ promise, payer }) {
  const provider = activeProvider();
  const existing = await Payment.findOne({
    promise: promise._id,
    status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FUNDED, PAYMENT_STATUS.HELD] },
  });
  if (existing && existing.status !== PAYMENT_STATUS.PENDING) {
    throw ApiError.conflict('This promise is already funded.');
  }

  const payment =
    existing ??
    (await Payment.create({
      promise: promise._id,
      payer: payer._id,
      recipient: {
        user: promise.recipient.user ?? null,
        name: promise.recipient.name,
        email: promise.recipient.email ?? null,
      },
      amount: promise.amount,
      currency: promise.currency,
      provider,
      status: PAYMENT_STATUS.PENDING,
    }));

  if (provider === 'razorpay') {
    const order = await razorpayRequest('/orders', {
      body: {
        amount: Math.round(promise.amount * 100),
        currency: promise.currency,
        receipt: promise.publicId,
        notes: { promiseId: promise.publicId, title: promise.title.slice(0, 100) },
      },
    });
    payment.providerOrderId = order.id;
    payment.provider = 'razorpay';
    await payment.save();
    return {
      payment,
      checkout: {
        provider: 'razorpay',
        orderId: order.id,
        amount: promise.amount,
        currency: promise.currency,
        keyId: env.payment.razorpayKeyId, // publishable identifier, never the secret
      },
    };
  }

  return {
    payment,
    checkout: {
      provider: 'demo',
      amount: promise.amount,
      currency: promise.currency,
      reference: `DEMO-${payment._id.toString().slice(-10).toUpperCase()}`,
    },
  };
}

/** Confirms that funding actually happened before a promise is treated as funded. */
export async function verifyPayment({ payment, providerPayload = {} }) {
  if (payment.provider === 'razorpay') {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
      providerPayload;
    if (!orderId || !paymentId || !signature) {
      throw ApiError.badRequest('The payment confirmation from the provider was incomplete.');
    }
    // The signature only proves the provider signed *some* order.
    if (payment.providerOrderId && orderId !== payment.providerOrderId) {
      throw ApiError.badRequest('That payment belongs to a different order. Nothing has been charged.');
    }
    const expected = crypto
      .createHmac('sha256', env.payment.razorpayKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) {
      payment.status = PAYMENT_STATUS.FAILED;
      payment.failureReason = 'Signature mismatch';
      await payment.save();
      throw ApiError.badRequest('That payment could not be verified. Nothing has been charged.');
    }
    payment.providerReference = paymentId;
  } else {
    payment.providerReference = `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  }

  payment.status = PAYMENT_STATUS.HELD;
  payment.fundedAt = new Date();
  await payment.save();
  return payment;
}

export function getPaymentStatus(promiseId) {
  return Payment.findOne({ promise: promiseId }).sort({ createdAt: -1 });
}

/** Releases held money to the recipient. */
export async function releasePayment({ payment, authorisedBy }) {
  if (!authorisedBy) throw ApiError.forbidden('A fulfillment must be authorised by a person.');

  /* Claiming the release is a single atomic step, not a read followed by a write. */
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: [PAYMENT_STATUS.HELD, PAYMENT_STATUS.FUNDED] } },
    { $set: { status: PAYMENT_STATUS.RELEASED, releasedAt: new Date(), authorisedBy: authorisedBy._id } },
    { new: true }
  );

  if (!claimed) {
    const current = await Payment.findById(payment._id);
    if (current?.status === PAYMENT_STATUS.RELEASED) {
      throw ApiError.conflict('This promise has already been fulfilled.');
    }
    throw ApiError.conflict('This promise has no funded amount to release.');
  }
  payment = claimed;

  if (payment.provider === 'razorpay') {
    // Capture confirms the held authorisation.
    try {
      const captured = await razorpayRequest(`/payments/${payment.providerReference}/capture`, {
        body: { amount: Math.round(payment.amount * 100), currency: payment.currency },
      });
      payment.metadata = { ...payment.metadata, capture: { id: captured.id, status: captured.status } };
    } catch (error) {
      logger.warn(`Razorpay capture failed: ${error.message}`);
      payment.metadata = { ...payment.metadata, captureError: error.message };
    }
  }

  // Status, releasedAt and authorisedBy were set by the atomic claim above.
  await payment.save();
  return payment;
}

export async function refundPayment({ payment, authorisedBy, reason = '' }) {
  if (!authorisedBy) throw ApiError.forbidden('A refund must be authorised by a person.');
  if (payment.status === PAYMENT_STATUS.REFUNDED) return payment;
  if (![PAYMENT_STATUS.HELD, PAYMENT_STATUS.FUNDED].includes(payment.status)) {
    throw ApiError.conflict('There is nothing held against this promise to refund.');
  }

  if (payment.provider === 'razorpay' && payment.providerReference) {
    const refund = await razorpayRequest(`/payments/${payment.providerReference}/refund`, {
      body: { amount: Math.round(payment.amount * 100), notes: { reason: reason.slice(0, 200) } },
    });
    payment.metadata = { ...payment.metadata, refund: { id: refund.id, status: refund.status } };
  }

  payment.status = PAYMENT_STATUS.REFUNDED;
  payment.refundedAt = new Date();
  payment.authorisedBy = authorisedBy._id;
  payment.failureReason = reason || null;
  await payment.save();
  return payment;
}
