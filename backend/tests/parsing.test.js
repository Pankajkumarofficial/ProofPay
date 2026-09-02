import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as localEngine from '../src/services/localEngine.js';

/**
 * The deterministic engine's amount extraction.
 *
 * This runs whenever no model is configured, and whenever one is rate limited or
 * down — which on a free tier is often. Getting the amount wrong is not a
 * cosmetic failure: it is the number the payer is committing.
 *
 * Both directions are tested. Missing a real amount strands a promise; reading
 * money out of "3 conditions" would put a number in front of someone that they
 * never wrote.
 */

const amountOf = (text) => localEngine.parsePromise({ text }).amount;

describe('amount extraction', () => {
  describe('currency before the number', () => {
    const cases = [
      ['Pay Ravi ₹7,500 after the docs are published', 7500],
      ['Pay Rahul Rs 10000 on delivery', 10000],
      ['Pay Sarah $1,500 when the logo files land', 1500],
      ['Release INR 25000 once she signs', 25000],
    ];
    for (const [text, expected] of cases) {
      test(text, () => assert.equal(amountOf(text), expected));
    }
  });

  describe('currency after the number', () => {
    // How people actually write small amounts. This was missed entirely until a
    // promise for "10 rupees" came through with an empty amount field.
    const cases = [
      ['I will pay Sushant 10 rupees for his honesty', 10],
      ['pay Asha 500 INR when the logo lands', 500],
      ['pay him 20 dollars for the fix', 20],
      ['settle 1,250 rupees on handover', 1250],
    ];
    for (const [text, expected] of cases) {
      test(text, () => assert.equal(amountOf(text), expected));
    }
  });

  describe('scaled and spelled-out', () => {
    const cases = [
      ['I will pay 2 lakh for the brand film', 200000],
      ['pay 25k when she signs', 25000],
      ['Pay 1.5 crore on completion', 15000000],
      ['pay ten thousand rupees for the audit', 10000],
    ];
    for (const [text, expected] of cases) {
      test(text, () => assert.equal(amountOf(text), expected));
    }
  });

  describe('money the sentence names without a currency', () => {
    // Nobody writes "rupees" in half the promises they type. When the wording
    // itself says the number is a payment — a total, or a sum handed to someone
    // by name — the amount is there to be read, and the bare-number rule's
    // four-digit floor would otherwise throw it away.
    const cases = [
      ['I will pay sahil a total of 5', 5],
      ['I will pay Sahil a total of 5', 5],
      ['pay sahil 5', 5],
      ['I owe sahil 250 total', 250],
      ['reward Meera 750 for the rewrite', 750],
      ['transfer priya 1,200 once the audit lands', 1200],
      ['pay a total of 1200 to sahil', 1200],
    ];
    for (const [text, expected] of cases) {
      test(text, () => assert.equal(amountOf(text), expected));
    }
  });

  describe('numbers that are not money', () => {
    // A false amount is worse than none: it puts a figure in front of the payer
    // that they never wrote, on a screen whose whole job is being checkable.
    const cases = [
      'split it into 3 conditions and 2 milestones',
      'deliver 5 screens by Friday',
      'all 12 tests must pass',
      'pay when the 3 revision rounds are approved',
      // A payment verb nearby is not enough on its own: what follows the number
      // is what decides whether it is a price or a count.
      'pay Rahul in 2 weeks',
      'pay Asha after 3 revisions',
      'pay the team once all 6 pages are signed off',
    ];
    for (const text of cases) {
      test(text, () => assert.equal(amountOf(text), null));
    }
  });

  describe('misspelled and mis-ordered currency words', () => {
    // The local engine runs whenever no model is configured or the model is down,
    // and a sentence typed in a hurry is exactly when it runs. A typo in the word
    // "rupees" is unambiguous — the word only ever labels money — so reading
    // through it costs nothing and saves the payer retyping the one number that
    // matters. The bare-number rule below still needs four digits, so "3
    // conditions" is never read as money.
    const cases = [
      ['I will pay Sushant 10 ruppes for his honesty', 10],
      ['I will sushant ruppes 10 for something', 10],
      ['pay Ravi rupes 250 for the fix', 250],
      ['pay Meera 400 rupaye on handover', 400],
    ];
    for (const [text, expected] of cases) {
      test(text, () => assert.equal(amountOf(text), expected));
    }
  });
});

/**
 * Who gets paid.
 *
 * An empty PAID TO field is not a neutral outcome: the form marks it required,
 * so a missed name is retyped by hand on every promise. A wrong name is worse,
 * which is why anything that is plainly not one — a pronoun, an article, a
 * currency code — is refused rather than guessed at.
 */
const recipientOf = (text) => localEngine.parsePromise({ text }).recipient;

describe('recipient extraction', () => {
  describe('names it should find', () => {
    const cases = [
      ['Pay Ravi ₹7,500 after the docs are published', /^Ravi$/],
      ['Release ₹7,500 to Ravi Kumar after the API docs are published', /^Ravi Kumar$/],
      // The capital letter is the first thing a hurried sentence loses; the
      // amount sitting right after the name is what identifies it instead.
      ['I will sushant ruppes 10 for something', /^sushant$/],
      ['pay asha 500 inr when the logo lands', /^asha$/],
      // The money need not be a bare number, and "will" must not let the name
      // swallow the verb after it: this names Sahil, not "pay sahil".
      ['I will pay sahil a total of 5', /^sahil$/],
      ['pay sahil 5', /^sahil$/],
      // "Rs" belongs to the amount, not to the name.
      ['Pay Rahul Rs 10000 on delivery', /^Rahul$/],
    ];
    for (const [text, expected] of cases) {
      test(text, () => assert.match(recipientOf(text) ?? '', expected));
    }
  });

  describe('words that are not names', () => {
    const cases = [
      'pay him 20 dollars for the fix',
      'Release INR 25000 once she signs',
      'I will pay you 500 rupees',
      'pay when the 3 revision rounds are approved',
    ];
    for (const text of cases) {
      test(text, () => assert.equal(recipientOf(text), null));
    }
  });
});

/**
 * Sentences where the person is named once and referred to after.
 *
 * "Chirag will help me in my work, I will pay him 10 rupees" is how people
 * actually write a promise: the name arrives first as the subject, and the
 * payment clause points back at it. Every pattern the parser had either looked
 * for a name *after* the payment verb — finding "him", and correctly refusing
 * it — or matched a short list of delivery verbs that did not include helping.
 * So the recipient came out empty with the name sitting in plain sight, and the
 * title kept the stranded pronoun: "Chirag will help me in my work him".
 *
 * This is the deterministic engine, which is what answers whenever the model is
 * rate limited — so on a free tier it is not the rare path.
 */
describe('a name introduced before the payment clause', () => {
  const parse = (text) => localEngine.parsePromise({ text });

  test('is found through the pronoun that refers back to it', () => {
    const result = parse('Chirag will help me in my work i will pay him 10 rupees');
    assert.equal(result.recipient, 'Chirag');
    assert.equal(result.amount, 10);
  });

  test('survives the comma people actually type', () => {
    assert.equal(
      parse('Chirag will help me in my work, I will pay him 10 rupees').recipient,
      'Chirag'
    );
  });

  test('reads any verb, not a list of delivery words', () => {
    assert.equal(parse('Meera will teach my daughter and I will pay her 3000').recipient, 'Meera');
    assert.equal(parse('Ravi will fix the tap, I will send him 800').recipient, 'Ravi');
  });

  test('names nobody rather than paying a noun', () => {
    // No person is named before the pronoun; "Website" must not be mistaken for one.
    assert.equal(parse('I will pay him 500 when the Website is done').recipient, null);
  });

  test('titles the work, not the price', () => {
    const result = parse('Chirag will help me in my work i will pay him 10 rupees');
    assert.equal(result.title, 'Chirag will help me in my work');
    assert.ok(!/\bhim\b/i.test(result.title), 'the stripped payment verb leaves no stranded pronoun');
  });
});
