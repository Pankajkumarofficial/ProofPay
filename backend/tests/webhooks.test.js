import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestApp, stopTestApp, client, fundedPromise } from './helpers.js';
import { Payment, PAYMENT_STATUS, PAYOUT_STATUS } from '../src/models/index.js';

/** What the provider says when nobody is watching. */

const SECRET = 'whsec-test-secret-for-proofpay';

let base;
before(async () => {
  base = await startTestApp({ RAZORPAY_WEBHOOK_SECRET: SECRET, PAYMENT_MODE: 'demo' });
});
after(stopTestApp);

const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('hex');

/** Posts a webhook the way Razorpay would: raw JSON plus a signature header. */
async function deliver(event, entity, { eventId = crypto.randomUUID(), signature } = {}) {
  const body = JSON.stringify({
    event,
    id: eventId,
    payload: event.startsWith('payout.') ? { payout: { entity } } : { payment: { entity } },
  });

  const response = await fetch(`${base}/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature ?? sign(body),
      'x-razorpay-event-id': eventId,
    },
    body,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/** A promise with money against it, and the provider reference the event names. */
async function payable() {
  const api = client(base);
  await api.signUp();
  const { promise } = await fundedPromise(api);
  const payment = await Payment.findOne({ promise: promise._id });
  return { promise, payment };
}

describe('a webhook that cannot prove who sent it', () => {
  test('is refused', async () => {
    const { payment } = await payable();
    const result = await deliver(
      'payment.captured',
      { id: 'pay_test', order_id: payment.providerReference },
      { signature: 'not-the-signature' }
    );

    assert.equal(result.status, 401, 'an unsigned instruction is not acted on');
  });

  test('is refused even when the body is otherwise valid', async () => {
    const { payment } = await payable();
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: payment.providerReference } } },
    });

    // Signed with the wrong secret: the right shape, the wrong sender.
    const response = await fetch(`${base}/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': crypto.createHmac('sha256', 'a-different-secret').update(body).digest('hex'),
      },
      body,
    });

    assert.equal(response.status, 401);
  });
});

describe('a payment the browser never reported', () => {
  test('is held once the provider says it was captured', async () => {
    const { payment } = await payable();
    // The state a payer who closed the tab would leave behind.
    await Payment.updateOne({ _id: payment._id }, { $set: { status: PAYMENT_STATUS.PENDING, fundedAt: null } });

    const result = await deliver('payment.captured', {
      id: 'pay_captured_1',
      order_id: payment.providerReference,
    });

    assert.equal(result.status, 200);
    const stored = await Payment.findById(payment._id).lean();
    assert.equal(stored.status, PAYMENT_STATUS.HELD);
    assert.ok(stored.fundedAt, 'the moment the money became conditional is recorded');
  });

  test('is not funded twice when the provider redelivers', async () => {
    const { payment } = await payable();
    await Payment.updateOne({ _id: payment._id }, { $set: { status: PAYMENT_STATUS.PENDING, fundedAt: null } });

    const entity = { id: 'pay_captured_2', order_id: payment.providerReference };
    const eventId = 'evt-delivered-twice';

    const first = await deliver('payment.captured', entity, { eventId });
    const second = await deliver('payment.captured', entity, { eventId });

    assert.equal(first.body.data.handled, true);
    assert.equal(second.body.data.handled, false, 'the repeat changes nothing');
    assert.equal(second.status, 200, 'and is still answered 200, or it is redelivered forever');

    const funded = await Payment.findById(payment._id).lean();
    assert.equal(funded.status, PAYMENT_STATUS.HELD);
  });
});

describe('a payout that finishes without anyone watching', () => {
  test('is recorded as processed, and says the provider confirmed it', async () => {
    const { payment } = await payable();

    const result = await deliver('payout.processed', {
      id: 'pout_1',
      order_id: payment.providerReference,
    });

    assert.equal(result.status, 200);
    const stored = await Payment.findById(payment._id).lean();
    assert.equal(stored.payout.status, PAYOUT_STATUS.PROCESSED);
    assert.equal(
      stored.payout.verification,
      'provider-confirmed',
      'a provider saying so is a stronger claim than a payer reporting it'
    );
  });

  test('is not undone by an older event arriving late', async () => {
    const { payment } = await payable();
    await deliver('payout.processed', { id: 'pout_2', order_id: payment.providerReference });

    // Providers do not guarantee order; a queued event can land after processed.
    await deliver('payout.queued', { id: 'pout_2', order_id: payment.providerReference });

    const stored = await Payment.findById(payment._id).lean();
    assert.equal(stored.payout.status, PAYOUT_STATUS.PROCESSED, 'a settled payout does not start again');
  });
});

describe('an event about something this instance has never seen', () => {
  test('is accepted and ignored, rather than retried forever', async () => {
    const result = await deliver('payment.captured', { id: 'pay_x', order_id: 'order_that_is_not_ours' });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.handled, false);
  });
});
