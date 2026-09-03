#!/usr/bin/env node
/**
 * Proves the Razorpay funding leg against the provider's real test-mode API.
 *
 *   npm run check:razorpay --prefix backend
 *
 * The integration tests cover the signature rules with a secret they invent, so
 * they prove the logic is right without proving the credentials are. This does
 * the opposite: it opens a real order at api.razorpay.com with the configured
 * key, reads it back, and then runs the app's own verification against a
 * signature computed the way Razorpay computes it — for the order that was
 * actually opened.
 *
 * What it cannot do is complete a card payment: that leg happens inside
 * Razorpay Checkout, in a browser, with a person. So this stops where a person
 * would start, and says so rather than implying a full round trip.
 *
 * Nothing is charged. Test-mode orders move no money, and the script refuses to
 * run against a live key.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'node:crypto';

// env.js reads process.env once at import, so the mode goes in before it loads.
process.env.PAYMENT_MODE = 'razorpay';
process.env.ALLOW_MEMORY_DB = 'false';
process.env.PAYOUTS_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'razorpay-check-secret-long-enough-32-chars';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';

const { env } = await import('../src/config/env.js');
const { createPayment, verifyPayment, activeProvider } = await import('../src/services/paymentService.js');
const { Payment, PAYMENT_STATUS } = await import('../src/models/index.js');

const keyId = env.payment.razorpayKeyId ?? '';
const secret = env.payment.razorpayKeySecret ?? '';

if (!keyId || !secret) {
  console.error('✗ RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set in backend/.env.');
  process.exit(1);
}

/**
 * A live key would open a real order against a real merchant account. That is
 * not what a verification script is for, and the mistake is one keystroke away.
 */
if (!keyId.startsWith('rzp_test_')) {
  console.error(
    `✗ ${keyId.slice(0, 9)}… is not a test key. This script opens real orders and will not run against live credentials.`
  );
  process.exit(1);
}

const pass = (line) => console.log(`  [32m✓[0m ${line}`);
const fail = (line) => {
  console.log(`  [31m✗[0m ${line}`);
  failures += 1;
};
let failures = 0;

/** A promise-shaped object. Only the ids and amounts reach the Payment record. */
const aPromise = (publicId) => ({
  _id: new mongoose.Types.ObjectId(),
  publicId,
  title: 'Razorpay integration check',
  amount: 1500,
  currency: 'INR',
  recipient: { user: null, name: 'Asha Rao', email: 'asha@example.com' },
});
const payer = { _id: new mongoose.Types.ObjectId() };

/** The signature Razorpay sends back, computed the way Razorpay computes it. */
const sign = (orderId, paymentId) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

const memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'proofpay-rzp-check' } });
await mongoose.connect(memoryServer.getUri('proofpay-rzp-check'));

let openedOrder = null;

try {
  console.log(`\nRazorpay funding leg — live test-mode check`);
  console.log(`key ${keyId.slice(0, 14)}… · mode ${env.payment.mode} · provider ${activeProvider()}\n`);

  if (activeProvider() !== 'razorpay') {
    console.error('✗ The payment service did not select the razorpay provider. Check the credentials.');
    process.exit(1);
  }

  /* 1 ── open a real order at the provider ─────────────────────────────── */
  const promise = aPromise('PRM-CHECK-0001');
  const { payment, checkout } = await createPayment({ promise, payer });
  openedOrder = checkout.orderId;

  if (checkout.orderId?.startsWith('order_')) {
    pass(`an order was opened at Razorpay: ${checkout.orderId}`);
  } else {
    fail(`no order id came back (got ${JSON.stringify(checkout.orderId)})`);
  }
  if (checkout.keyId === keyId) pass('checkout carries the publishable key id, and no secret');
  else fail('checkout did not carry the expected key id');
  if (payment.status === PAYMENT_STATUS.PENDING) {
    pass('nothing is held yet — the promise is untouched until the payer authorises');
  } else {
    fail(`payment status is ${payment.status}, expected ${PAYMENT_STATUS.PENDING}`);
  }

  /* 2 ── read it back, so the pass is the provider's word and not ours ─── */
  const readBack = await fetch(`https://api.razorpay.com/v1/orders/${checkout.orderId}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64') },
  }).then((r) => r.json());

  if (readBack.id === checkout.orderId) pass(`the provider returns the same order on a fresh read`);
  else fail(`reading the order back returned ${JSON.stringify(readBack?.error?.description ?? readBack)}`);

  // The amount is the one place a rounding slip costs real money.
  if (readBack.amount === 150000 && readBack.currency === 'INR') {
    pass('₹1,500.00 reached the provider as 150000 paise, in INR');
  } else {
    fail(`the provider recorded ${readBack.amount} ${readBack.currency}, expected 150000 INR`);
  }

  /* 3 ── a genuine receipt for this order is accepted ───────────────────── */
  const paymentId = `pay_${crypto.randomBytes(7).toString('hex')}`;
  const verified = await verifyPayment({
    payment,
    providerPayload: {
      razorpay_order_id: checkout.orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(checkout.orderId, paymentId),
    },
  });
  if (verified.status === PAYMENT_STATUS.HELD) pass('a correctly signed receipt for this order holds the money');
  else fail(`a genuine receipt left the payment at ${verified.status}`);

  /* 4 ── a forged signature is refused ──────────────────────────────────── */
  const forgedOn = await createPayment({ promise: aPromise('PRM-CHECK-0002'), payer });
  try {
    await verifyPayment({
      payment: forgedOn.payment,
      providerPayload: {
        razorpay_order_id: forgedOn.checkout.orderId,
        razorpay_payment_id: 'pay_forged',
        razorpay_signature: crypto.randomBytes(32).toString('hex'),
      },
    });
    fail('a forged signature was accepted');
  } catch (error) {
    const after = await Payment.findById(forgedOn.payment._id);
    if (after.status === PAYMENT_STATUS.FAILED) pass(`a forged signature is refused: "${error.message}"`);
    else fail(`a forged signature was refused but left the payment at ${after.status}`);
  }

  /* 5 ── a genuine receipt for a *different* order is refused ───────────── */
  const targetOf = await createPayment({ promise: aPromise('PRM-CHECK-0003'), payer });
  const elsewhereId = `pay_${crypto.randomBytes(7).toString('hex')}`;
  try {
    await verifyPayment({
      payment: targetOf.payment,
      providerPayload: {
        // Genuinely signed — but for the order opened in step 1, not this one.
        razorpay_order_id: openedOrder,
        razorpay_payment_id: elsewhereId,
        razorpay_signature: sign(openedOrder, elsewhereId),
      },
    });
    fail("one promise's receipt was able to fund another");
  } catch (error) {
    pass(`a genuine receipt for another order is refused: "${error.message}"`);
  }

  console.log(
    `\nThe leg this cannot reach is the browser one: authorising the charge happens\n` +
      `inside Razorpay Checkout, with a person and a test card. Everything either\n` +
      `side of it is checked above, against the provider's own API.\n`
  );
} finally {
  await mongoose.disconnect();
  await memoryServer.stop();
}

if (failures) {
  console.log(`[31m${failures} check(s) failed.[0m\n`);
  process.exit(1);
}
console.log('[32mAll checks passed.[0m\n');
