import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp, client, fundedPromise, proveIt } from './helpers.js';

/** A payout is the slow, failure-prone half of paying someone. */

let base;
before(async () => {
  base = await startTestApp({
    PAYOUTS_ENABLED: 'true',
    PAYOUT_PROVIDER: 'simulated',
    PAYOUT_SIM_SETTLE_MS: '1', // every refresh lands in a terminal state
  });
});
after(stopTestApp);

async function releaseTo(api, destination) {
  const { promise, conditionId } = await fundedPromise(api);
  await api.call(`/promises/${promise._id}/payout-destination`, { body: destination });
  await proveIt(api, promise._id, conditionId);
  const fulfilled = await api.call(`/promises/${promise._id}/fulfill`, {
    body: { confirm: true, note: 'proven' },
  });
  return { promise, fulfilled };
}

describe('payout destinations', () => {
  test('never stores the account number or IFSC', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await fundedPromise(api);

    await api.call(`/promises/${promise._id}/payout-destination`, {
      body: {
        method: 'bank',
        accountHolder: 'Asha Rao',
        accountNumber: '1234567890123',
        ifsc: 'HDFC0001234',
      },
    });

    const stored = await api.get(`/promises/${promise._id}`);
    const raw = JSON.stringify(stored.body.data.promise);

    assert.ok(!raw.includes('1234567890123'), 'the account number must not be persisted');
    assert.ok(!raw.includes('HDFC0001234'), 'the IFSC must not be persisted');
    assert.match(stored.body.data.promise.recipient.payoutDestination.label, /····0123/);
  });

  test('records the destination in the Chronicle, masked', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await fundedPromise(api);

    await api.call(`/promises/${promise._id}/payout-destination`, {
      body: { method: 'bank', accountHolder: 'Asha Rao', accountNumber: '1234567890123', ifsc: 'HDFC0001234' },
    });

    const chronicle = await api.get(`/promises/${promise._id}/chronicle`);
    const entries = chronicle.body.data.entries ?? chronicle.body.data.chronicle ?? [];
    const entry = entries.find((row) => /payout destination/i.test(row.summary ?? ''));

    assert.ok(entry, 'setting a destination must reach the append-only Chronicle');
    assert.match(entry.summary, /····0123/, 'the entry shows the masked label');
    assert.ok(!entry.summary.includes('1234567890123'), 'and never the account number');
  });

  test('rejects a malformed IFSC and UPI id', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await fundedPromise(api);

    const badBank = await api.call(`/promises/${promise._id}/payout-destination`, {
      body: { method: 'bank', accountHolder: 'A', accountNumber: '12', ifsc: 'nope' },
    });
    assert.equal(badBank.status, 400);

    const badUpi = await api.call(`/promises/${promise._id}/payout-destination`, {
      body: { method: 'upi', vpa: 'not-a-upi-id' },
    });
    assert.equal(badUpi.status, 400);
  });
});

describe('payout lifecycle', () => {
  test('a release starts a payout without claiming it has arrived', async () => {
    const api = client(base);
    await api.signUp();
    const { fulfilled } = await releaseTo(api, { method: 'upi', vpa: 'asha@okhdfcbank' });

    assert.equal(fulfilled.body.data.payment.status, 'RELEASED');
    assert.equal(fulfilled.body.data.payout.provider, 'simulated');
    assert.ok(
      ['queued', 'processing'].includes(fulfilled.body.data.payout.status),
      'a fresh payout must not report itself as already paid'
    );
    assert.equal(fulfilled.body.data.payout.utr, null, 'no UTR before the money lands');
    assert.equal(
      fulfilled.body.data.promise.status,
      'SETTLING',
      'the promise cannot read as fulfilled while the money is still in the rail'
    );
  });

  test('settles to processed with a UTR', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releaseTo(api, { method: 'upi', vpa: 'asha@okhdfcbank' });

    const refreshed = await api.call(`/promises/${promise._id}/payout/refresh`);

    assert.equal(refreshed.body.data.payout.status, 'processed');
    assert.match(refreshed.body.data.payout.utr, /^SIM/);

    // Arriving is what fulfils a promise, and the refresh is where that is learnt.
    const after = await api.get(`/promises/${promise._id}`);
    assert.equal(after.body.data.promise.status, 'FULFILLED');
    assert.ok(after.body.data.promise.fulfilledAt, 'fulfilledAt marks the money landing');
  });

  test('a failed payout is reported, and does not undo the release', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releaseTo(api, { method: 'upi', vpa: 'fail@okhdfcbank' });

    const refreshed = await api.call(`/promises/${promise._id}/payout/refresh`);

    assert.equal(refreshed.body.data.payout.status, 'failed');
    assert.ok(refreshed.body.data.payout.failureReason);
    // The payer's decision stands even when the bank rail does not.
    assert.equal(refreshed.body.data.payment.status, 'RELEASED');
    const after = await api.get(`/promises/${promise._id}`);
    // ...but nobody was paid, so the promise must not claim fulfilment.
    assert.equal(after.body.data.promise.status, 'SETTLING');
    assert.equal(after.body.data.promise.fulfilledAt, null);
  });

  test('a reversal keeps its UTR, because the bank accepted it first', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releaseTo(api, { method: 'upi', vpa: 'reverse@okhdfcbank' });

    const refreshed = await api.call(`/promises/${promise._id}/payout/refresh`);

    assert.equal(refreshed.body.data.payout.status, 'reversed');
    assert.match(refreshed.body.data.payout.utr, /^SIM/);
  });

  test('a terminal payout is not re-sent by a refresh', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await releaseTo(api, { method: 'upi', vpa: 'asha@okhdfcbank' });

    const first = await api.call(`/promises/${promise._id}/payout/refresh`);
    const second = await api.call(`/promises/${promise._id}/payout/refresh`);

    assert.equal(second.body.data.payout.status, 'processed');
    assert.equal(second.body.data.payout.utr, first.body.data.payout.utr, 'the UTR must not change');
    assert.equal(second.body.data.payout.id, first.body.data.payout.id);
  });

  test('refuses to check a payout on a promise that was never released', async () => {
    const api = client(base);
    await api.signUp();
    const { promise } = await fundedPromise(api);

    const result = await api.call(`/promises/${promise._id}/payout/refresh`);
    assert.equal(result.status, 409);
  });
});
