import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateUtr } from '../src/utils/utr.js';

/**
 * A UPI reference is `Y DDD SSSSSSSS` — year digit, Julian day, trace number.
 * These tests pin down what that structure lets us reject, and are equally
 * careful to prove what it does not: none of this confirms a bank moved money.
 */

/** A reference a bank would plausibly issue for a payment made on `date`. */
function realisticUtr(date, trace = '40271993') {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  return `${date.getUTCFullYear() % 10}${String(day).padStart(3, '0')}${trace}`;
}

const authorisedAt = new Date();

describe('UTR validation', () => {
  test('accepts a well-formed reference for today', () => {
    const result = validateUtr(realisticUtr(authorisedAt), { authorisedAt });

    assert.equal(result.valid, true);
    assert.equal(result.utr.length, 12);
    // Never "verified" — the wording matters, because no bank was asked.
    assert.equal(result.verification, 'format-checked');
  });

  test('tolerates spaces, because people paste from a bank app', () => {
    const utr = realisticUtr(authorisedAt);
    const spaced = `${utr.slice(0, 4)} ${utr.slice(4, 8)} ${utr.slice(8)}`;

    const result = validateUtr(spaced, { authorisedAt });
    assert.equal(result.valid, true);
    assert.equal(result.utr, utr);
  });

  describe('rejects invented references', () => {
    const cases = [
      ['empty', ''],
      ['too short', '12345'],
      ['too long', '1234567890123456'],
      ['letters', 'ABCD12345678'],
      ['a NEFT-style reference', 'SBIN12345678901X'],
      ['all the same digit', '111111111111'],
      ['the obvious placeholder', '123456789012'],
      ['day 000', '6000' + '40271993'],
      ['day 999', '6999' + '40271993'],
      ['day 400', '6400' + '40271993'],
    ];

    for (const [label, input] of cases) {
      test(label, () => {
        const result = validateUtr(input, { authorisedAt });
        assert.equal(result.valid, false, `"${input}" must be rejected`);
        assert.ok(result.reason, 'and must say why');
      });
    }
  });

  test('rejects a reference dated before the payment was authorised', () => {
    const lastMonth = new Date(authorisedAt.getTime() - 30 * 86400000);
    const result = validateUtr(realisticUtr(lastMonth), { authorisedAt });

    assert.equal(result.valid, false);
    assert.match(result.reason, /before the payment was authorised/i);
  });

  test('rejects a reference dated in the future', () => {
    const nextMonth = new Date(authorisedAt.getTime() + 30 * 86400000);
    const result = validateUtr(realisticUtr(nextMonth), { authorisedAt });

    assert.equal(result.valid, false);
    assert.match(result.reason, /future/i);
  });

  test('allows a day of drift, for bank clocks and timezones', () => {
    const tomorrow = new Date(authorisedAt.getTime() + 86400000);
    assert.equal(validateUtr(realisticUtr(tomorrow), { authorisedAt }).valid, true);

    const yesterday = new Date(authorisedAt.getTime() - 86400000);
    assert.equal(validateUtr(realisticUtr(yesterday), { authorisedAt }).valid, true);
  });

  test('a random 12-digit number almost never passes', () => {
    let accepted = 0;
    for (let i = 0; i < 2000; i += 1) {
      const guess = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
      if (validateUtr(guess, { authorisedAt }).valid) accepted += 1;
    }
    // Only this year's digit and a handful of days around today can pass:
    // roughly 1 in 1000 guesses, so a fabricated reference is not a coin flip.
    assert.ok(accepted / 2000 < 0.01, `too many random numbers passed (${accepted}/2000)`);
  });

  test('does not claim a bank confirmed anything', () => {
    const result = validateUtr(realisticUtr(authorisedAt), { authorisedAt });
    assert.notEqual(result.verification, 'provider-confirmed');
  });
});
