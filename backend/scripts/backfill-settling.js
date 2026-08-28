#!/usr/bin/env node
/**
 * Re-reads promises that were marked FULFILLED before fulfilment meant "paid".
 *
 *   npm run backfill:settling -- --dry
 *
 * Until now a release set FULFILLED straight away, so a promise whose payout is
 * still pending — a UPI payment the payer has not made yet, a transfer that
 * failed — is recorded as paid. This moves exactly those to SETTLING, where
 * recording the UTR (or a successful payout) takes them back to FULFILLED.
 *
 * A promise whose payout actually landed, or that never had a rail to wait for,
 * is left alone. Nothing else about the promise is touched, and the payment and
 * Chronicle are read-only here.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { PromiseModel, Payment, PROMISE_STATUS } from '../src/models/index.js';
import { payoutSettled } from '../src/services/payoutService.js';

const dryRun = process.argv.includes('--dry');

await connectDatabase();

const fulfilled = await PromiseModel.find({ status: PROMISE_STATUS.FULFILLED });
let moved = 0;

for (const promise of fulfilled) {
  const payment = await Payment.findOne({ promise: promise._id }).sort({ createdAt: -1 });
  if (payoutSettled(payment?.payout)) continue;

  logger.info(
    `${promise.publicId} · ${promise.title.slice(0, 40)} — payout ${
      payment?.payout?.status ?? 'none'
    } → SETTLING`
  );
  moved += 1;
  if (dryRun) continue;

  promise.status = PROMISE_STATUS.SETTLING;
  promise.fulfilledAt = null;
  await promise.save();
}

logger.info(
  dryRun
    ? `${moved} of ${fulfilled.length} fulfilled promises would move to SETTLING.`
    : `${moved} of ${fulfilled.length} fulfilled promises moved to SETTLING.`
);

await disconnectDatabase();
