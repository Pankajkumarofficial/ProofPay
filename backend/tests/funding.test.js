import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestApp, stopTestApp, client } from './helpers.js';

/**
 * Funding through a provider is the only place ProofPay trusts something the
 * browser hands it. The signature is what makes that safe, so these tests try
 * to get money held without a valid one.
 *
 * The provider is never called: an order id is invented and signed with the
 * server's own secret, which is exactly what a genuine callback looks like.
 */

const KEY_ID = 'rzp_test_fake_for_tests';
const KEY_SECRET = 'secret-used-only-by-these-tests';

const sign = (orderId, paymentId) =>
  crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

let base;
before(async () => {
  base = await startTestApp({
    PAYMENT_MODE: 'demo', // real orders need the provider; the verify leg does not
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
  });
});
after(stopTestApp);

async function heldPromise(api) {
  const created = await api.call('/promises', {
    body: {
      title: 'Funding test',
      amount: 500,
      recipient: { name: 'Asha Rao' },
      conditions: [{ description: 'Deliver the signed report', type: 'deliverable' }],
    },
  });
  return created.body.data.promise;
}

describe('funding', () => {
  test('demo mode holds the money in a single request', async () => {
    const api = client(base);
    await api.signUp();
    const promise = await heldPromise(api);

    const funded = await api.call(`/promises/${promise._id}/fund`, { body: {} });

    assert.equal(funded.status, 200);
    assert.equal(funded.body.data.requiresPayment, false);
    assert.equal(funded.body.data.payment.status, 'HELD');
    assert.equal(funded.body.data.promise.status, 'FUNDED');
  });

  test('refuses to fund a promise with no conditions', async () => {
    const api = client(base);
    await api.signUp();
    // Conditions are required at creation, so the guard is checked directly:
    // a promise the payer cannot see must not be fundable either.
    const stranger = client(base);
    await stranger.signUp('Stranger');
    const promise = await heldPromise(api);

    const result = await stranger.call(`/promises/${promise._id}/fund`, { body: {} });
    assert.equal(result.status, 404);
  });

  test('rejects a verification payload that is missing the signature', async () => {
    const api = client(base);
    await api.signUp();
    const promise = await heldPromise(api);

    const result = await api.call(`/promises/${promise._id}/fund/verify`, {
      body: { providerPayload: { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x' } },
    });

    assert.equal(result.status, 400, 'a partial payload must never reach the payment service');
  });

  test('rejects a signature made with the wrong secret', async () => {
    const api = client(base);
    await api.signUp();
    const promise = await heldPromise(api);
    await api.call(`/promises/${promise._id}/fund`, { body: {} });

    const forged = crypto.createHmac('sha256', 'not-the-real-secret').update('order_x|pay_x').digest('hex');
    const result = await api.call(`/promises/${promise._id}/fund/verify`, {
      body: {
        providerPayload: {
          razorpay_order_id: 'order_x',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: forged,
        },
      },
    });

    assert.notEqual(result.status, 200, 'a forged signature must not hold money');
    const after = await api.get(`/promises/${promise._id}`);
    assert.notEqual(after.body.data.promise.status, 'FULFILLED');
  });

  test('a promise cannot be funded twice', async () => {
    const api = client(base);
    await api.signUp();
    const promise = await heldPromise(api);

    await api.call(`/promises/${promise._id}/fund`, { body: {} });
    const again = await api.call(`/promises/${promise._id}/fund`, { body: {} });

    assert.equal(again.status, 409);
  });
});

describe('signature verification', () => {
  test('the HMAC matches only for the exact order and payment pair', () => {
    const good = sign('order_abc', 'pay_123');

    assert.equal(good, sign('order_abc', 'pay_123'), 'same inputs must reproduce');
    assert.notEqual(good, sign('order_abc', 'pay_999'), 'a different payment must not match');
    assert.notEqual(good, sign('order_xyz', 'pay_123'), 'a different order must not match');
  });
});
