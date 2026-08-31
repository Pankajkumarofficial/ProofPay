import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp, client, fundedPromise, proveIt } from './helpers.js';

/**
 * The distance between a release and a payment.
 *
 * On the UPI rail ProofPay sends nothing: it hands the payer a pre-filled
 * payment their own bank app executes, then waits for the reference. So there
 * is a real interval in which the payer has authorised the money and nobody has
 * been paid — and a promise that called itself FULFILLED in that interval would
 * be telling the recipient something untrue on the one screen whose whole job
 * is being checkable.
 *
 * These tests hold that line: SETTLING until the UTR, FULFILLED after it.
 */

let base;
before(async () => {
  base = await startTestApp({ PAYOUTS_ENABLED: 'true', PAYOUT_PROVIDER: 'upi-intent' });
});
after(stopTestApp);

/** A reference a bank would plausibly issue today. */
function realisticUtr(date = new Date(), trace = '40271993') {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000
  );
  return `${date.getUTCFullYear() % 10}${String(day).padStart(3, '0')}${trace}`;
}

async function releasedPromise(api, { vpa = 'asha@okhdfcbank' } = {}) {
  const { promise, conditionId } = await fundedPromise(api);
  await api.call(`/promises/${promise._id}/payout-destination`, { body: { method: 'upi', vpa } });
  await proveIt(api, promise._id, conditionId);
  const fulfilled = await api.call(`/promises/${promise._id}/fulfill`, {
    body: { confirm: true, note: 'proven' },
  });
  return { promise, fulfilled };
}

describe('settlement', () => {
  test('a released UPI promise settles rather than fulfils', async () => {
    const api = client(base);
    await api.signUp();
    const { promise, fulfilled } = await releasedPromise(api);

    assert.equal(fulfilled.status, 200);
    assert.equal(fulfilled.body.data.payment.status, 'RELEASED');
    assert.equal(fulfilled.body.data.payout.status, 'pending');
    assert.equal(fulfilled.body.data.promise.status, 'SETTLING');

    const stored = await api.get(`/promises/${promise._id}`);
    assert.equal(stored.body.data.promise.status, 'SETTLING');
    assert.equal(stored.body.data.promise.fulfilledAt, null, 'nothing was fulfilled yet');
  });

  test('recording the UTR is what fulfils it', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releasedPromise(api);

    const confirmed = await api.call(`/promises/${promise._id}/payout/confirm`, {
      body: { utr: realisticUtr() },
    });

    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.payout.status, 'processed');
    assert.equal(confirmed.body.data.promise.status, 'FULFILLED');

    const stored = await api.get(`/promises/${promise._id}`);
    assert.equal(stored.body.data.promise.status, 'FULFILLED');
    assert.ok(stored.body.data.promise.fulfilledAt);

    // And the Chronicle records the fulfilment where the money moved, not where
    // the button was pressed.
    const chronicle = await api.get(`/promises/${promise._id}/chronicle`);
    const entries = chronicle.body.data.entries ?? [];
    assert.ok(entries.some((entry) => /every condition proven and the money paid/i.test(entry.summary ?? '')));
  });

  test('a real reference that does not decode still settles, at the weaker grade', async () => {
    // The shape that stranded a payment: twelve digits whose 2–4 read 609, which
    // is not a day of the year. The bank composes those digits, so this is
    // recorded — and marked as taken on the payer's word.
    const api = client(base);
    await api.signUp();
    const { promise } = await releasedPromise(api);

    const confirmed = await api.call(`/promises/${promise._id}/payout/confirm`, {
      body: { utr: '660956253847' },
    });

    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.payout.status, 'processed');
    assert.equal(confirmed.body.data.payout.verification, 'payer-reported');
    assert.match(confirmed.body.data.payout.verificationNote, /not a day of the year/i);
    assert.match(confirmed.body.data.payout.summary, /not date-checked/i);
    assert.equal(confirmed.body.data.promise.status, 'FULFILLED');
  });

  test('a rejected reference leaves the promise settling', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releasedPromise(api);

    const rejected = await api.call(`/promises/${promise._id}/payout/confirm`, {
      body: { utr: '111111111111' },
    });

    assert.equal(rejected.status, 400);
    const stored = await api.get(`/promises/${promise._id}`);
    assert.equal(stored.body.data.promise.status, 'SETTLING');
  });

  test('a settling promise cannot be released a second time, edited or cancelled', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releasedPromise(api);

    const again = await api.call(`/promises/${promise._id}/fulfill`, { body: { confirm: true } });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /already been released/i);

    const edited = await api.call(`/promises/${promise._id}`, {
      method: 'PATCH',
      body: { title: 'Renamed after release' },
    });
    assert.equal(edited.status, 409);

    const cancelled = await api.call(`/promises/${promise._id}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 409);
  });

  test('a release with nowhere to send it does not read as paid', async () => {
    // No payout destination: the rail is on, so this is money that has not been
    // sent — not a promise that settled inside ProofPay.
    const api = client(base);
    await api.signUp();
    const { promise, conditionId } = await fundedPromise(api);
    await proveIt(api, promise._id, conditionId);

    const fulfilled = await api.call(`/promises/${promise._id}/fulfill`, {
      body: { confirm: true, note: 'proven' },
    });

    assert.equal(fulfilled.body.data.payout.status, 'NOT_SENT');
    assert.equal(fulfilled.body.data.promise.status, 'SETTLING');
  });
});
