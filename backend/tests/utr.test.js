import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateUtr } from '../src/utils/utr.js';

/**
 * A UPI reference is `Y DDD SSSSSSSS` — year digit, Julian day, trace number —
 * by convention, not by rule. These tests pin down the two things that follow:
 * what cannot be a reference at all is rejected, and everything else is graded
 * rather than refused, because a real reference that does not decode belongs to
 * a payment that really happened.
 *
 * They are equally careful to prove what none of this does: confirm that a bank
 * moved money.
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
    ];

    for (const [label, input] of cases) {
      test(label, () => {
        const result = validateUtr(input, { authorisedAt });
        assert.equal(result.valid, false, `"${input}" must be rejected`);
        assert.ok(result.reason, 'and must say why');
      });
    }
  });

  describe('records what it cannot place, and says so', () => {
    /**
     * The bank composes these digits, not NPCI, and real apps hand out
     * references that decode to nothing. Refusing one strands a promise whose
     * money has actually moved — with no way forward but a database edit — so
     * the reading becomes a grade on the record instead of a locked door.
     */
    const cases = [
      ['a day that is not a day of the year', '660956253847', /not a day of the year/i],
      ['day 000', `6000${'40271993'}`, /not a day of the year/i],
      ['day 400', `6400${'40271993'}`, /not a day of the year/i],
      [
        'a date before the payment was authorised',
        realisticUtr(new Date(authorisedAt.getTime() - 30 * 86400000)),
        /before you authorised/i,
      ],
      [
        'a date in the future',
        realisticUtr(new Date(authorisedAt.getTime() + 30 * 86400000)),
        /future/i,
      ],
    ];

    for (const [label, input, note] of cases) {
      test(label, () => {
        const result = validateUtr(input, { authorisedAt });

        assert.equal(result.valid, true, 'a well-formed reference is never refused');
        // But it is not worth what a reference that fits the transfer is worth.
        assert.equal(result.verification, 'payer-reported');
        assert.match(result.note, note, 'and the record carries why');
      });
    }
  });

  test('allows a day of drift, for bank clocks and timezones', () => {
    const tomorrow = new Date(authorisedAt.getTime() + 86400000);
    assert.equal(validateUtr(realisticUtr(tomorrow), { authorisedAt }).verification, 'format-checked');

    const yesterday = new Date(authorisedAt.getTime() - 86400000);
    assert.equal(validateUtr(realisticUtr(yesterday), { authorisedAt }).verification, 'format-checked');
  });

  test('a random 12-digit number almost never earns the stronger grade', () => {
    // What the structure buys is no longer a refusal — it is the difference
    // between a reference that fits this transfer and one taken on the payer's
    // word. A guess almost never fits.
    let dateChecked = 0;
    for (let i = 0; i < 2000; i += 1) {
      const guess = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
      if (validateUtr(guess, { authorisedAt }).verification === 'format-checked') dateChecked += 1;
    }
    // Only this year's digit and a handful of days around today can fit:
    // roughly 1 in 1000 guesses.
    assert.ok(dateChecked / 2000 < 0.01, `too many random numbers were date-checked (${dateChecked}/2000)`);
  });

  test('does not claim a bank confirmed anything, at either grade', () => {
    assert.notEqual(validateUtr(realisticUtr(authorisedAt), { authorisedAt }).verification, 'provider-confirmed');
    assert.notEqual(validateUtr('660956253847', { authorisedAt }).verification, 'provider-confirmed');
  });
});
