import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as localEngine from '../src/services/localEngine.js';

/** The deterministic engine's amount extraction. */

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
    // How people actually write small amounts.
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
    // Nobody writes "rupees" in half the promises they type.
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
    // A false amount is worse than none.
    const cases = [
      'split it into 3 conditions and 2 milestones',
      'deliver 5 screens by Friday',
      'all 12 tests must pass',
      'pay when the 3 revision rounds are approved',
      // A payment verb nearby is not enough on its own.
      'pay Rahul in 2 weeks',
      'pay Asha after 3 revisions',
      'pay the team once all 6 pages are signed off',
    ];
    for (const text of cases) {
      test(text, () => assert.equal(amountOf(text), null));
    }
  });

  describe('misspelled and mis-ordered currency words', () => {
    // The local engine runs whenever no model is configured or the model is down.
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

/** Who gets paid. */
const recipientOf = (text) => localEngine.parsePromise({ text }).recipient;

describe('recipient extraction', () => {
  describe('names it should find', () => {
    const cases = [
      ['Pay Ravi ₹7,500 after the docs are published', /^Ravi$/],
      ['Release ₹7,500 to Ravi Kumar after the API docs are published', /^Ravi Kumar$/],
      // The capital letter is the first thing a hurried sentence loses.
      ['I will sushant ruppes 10 for something', /^sushant$/],
      ['pay asha 500 inr when the logo lands', /^asha$/],
      // The money need not be a bare number, and "will" must not let the name swallow the verb after it.
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

/** Sentences where the person is named once and referred to after. */
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
