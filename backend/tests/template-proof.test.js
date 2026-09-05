import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, stopTestApp, client, fundedPromise } from './helpers.js';

/**
 * A blank form must not prove anything.
 *
 * An acceptance certificate was filed against a promise and verified at 95%.
 * It listed five acceptance tests, each marked PASS, and stated that the payer
 * approved the final version — and every identifying field in it was an empty
 * placeholder. No name, no date, no signature, no test names: `[Your full
 * name]`, `[DD Month YYYY]`, a row of underscores where a signature goes.
 *
 * The engine was asked only whether the proof satisfied the condition, and the
 * body of a template says yes to that, fluently. It was a false accept on the
 * single measure this product ranks itself by, and it was invisible because
 * nothing in the document was *wrong* — a document naming nobody contradicts
 * nobody. Refusing it deterministically, before any model call, is the only
 * version of that claim that does not depend on a provider being observant.
 */

const CERTIFICATE = `
DELIVERY AND ACCEPTANCE CERTIFICATE
Promise reference [PRM-XXXX-XXXX]

1. The website was delivered by [Developer name] on [DD Month YYYY] and handed
   over in full.

2. Acceptance test results. The five acceptance tests were executed on
   [DD Month YYYY] against version [v1.0]. All five returned a pass.

   01  [Test 1 name]   [expected behaviour]   PASS
   02  [Test 2 name]   [expected behaviour]   PASS
   03  [Test 3 name]   [expected behaviour]   PASS
   04  [Test 4 name]   [expected behaviour]   PASS
   05  [Test 5 name]   [expected behaviour]   PASS
   Total 5 of 5 tests passed PASS

3. I, [Your full name], the payer under this promise, confirm that I have
   reviewed the final version and approve it without reservation.

Approved by (payer)                Acknowledged by (developer)
_______________________________    _______________________________
[Your full name]                   [Developer name]
Date: [DD Month YYYY]              Date: [DD Month YYYY]
`;

/** The same certificate, completed. Nothing here may be refused for being a form. */
const COMPLETED = CERTIFICATE.replace(/\[Your full name\]/g, 'Aman Rohilla')
  .replace(/\[Developer name\]/g, 'Rahul Verma')
  .replace(/\[DD Month YYYY\]/g, '3 September 2026')
  .replace(/\[PRM-XXXX-XXXX\]/g, 'PRM-QKDM-NDBR')
  .replace(/\[v1\.0\]/g, 'v1.0')
  .replace(/\[Test (\d) name\]/g, 'Checkout flow $1')
  .replace(/\[expected behaviour\]/g, 'completes without error')
  .replace(/_{6,}/g, 'signed');

let api;
let Evidence;

before(async () => {
  api = await startTestApp();
  ({ Evidence } = await import('../src/models/index.js'));
});
after(stopTestApp);

/** Files a document as proof and waits for the reading to settle. */
async function fileDocument(person, promise, conditionId, name, body) {
  const filed = await person.upload('/evidence', {
    fields: {
      promiseId: promise._id,
      conditionId,
      type: 'document',
      title: name,
      autoVerify: 'true',
    },
    file: { name, contentType: 'text/plain', bytes: Buffer.from(body, 'utf8') },
  });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  const { settleAssessments } = await import('../src/controllers/evidenceController.js');
  await settleAssessments();
  return Evidence.findById(filed.body.data.evidence._id).lean();
}

describe('a document that was never filled in', () => {
  test('is refused, however completely its wording claims the condition is met', async () => {
    const person = client(api);
    await person.signUp();
    const { promise, conditionId } = await fundedPromise(person);

    const assessed = await fileDocument(
      person,
      promise,
      conditionId,
      'acceptance-certificate.txt',
      CERTIFICATE
    );

    assert.notEqual(assessed.status, 'ACCEPTED', 'a blank form must never prove a condition');
    assert.match(assessed.aiExplanation, /template|unfilled|never completed/i);
  });

  test('names the fields that were left blank, so the sender can fix it', async () => {
    const person = client(api);
    await person.signUp();
    const { promise, conditionId } = await fundedPromise(person);

    const assessed = await fileDocument(
      person,
      promise,
      conditionId,
      'certificate.txt',
      CERTIFICATE
    );

    // The explanation has to be actionable: a refusal that does not say which
    // fields are empty leaves the sender guessing at what to change.
    assert.match(assessed.aiExplanation, /\[Your full name\]|\[DD Month YYYY\]/);
  });

  test('does not refuse the same certificate once it has been completed', async () => {
    const person = client(api);
    await person.signUp();
    const { promise, conditionId } = await fundedPromise(person);

    const assessed = await fileDocument(
      person,
      promise,
      conditionId,
      'acceptance-certificate-signed.txt',
      COMPLETED
    );

    // The guard is about blank fields, not about certificates. A filled-in one
    // goes to the engine on its merits — whatever the engine then decides.
    assert.doesNotMatch(assessed.aiExplanation ?? '', /unfilled template/i);
  });
});

describe('the placeholder detector', () => {
  test('ignores a document that merely cites or brackets a word', async () => {
    const { looksLikeTemplate } = await import('../src/utils/template.js');
    const prose =
      'The deployment [1] completed on 3 September 2026 and the client confirmed [sic] receipt.';
    assert.equal(looksLikeTemplate(prose), false);
  });

  test('needs more than one blank before calling a document a form', async () => {
    const { looksLikeTemplate } = await import('../src/utils/template.js');
    assert.equal(looksLikeTemplate('Signed by [name] on 3 September 2026.'), false);
    assert.equal(
      looksLikeTemplate('Signed by [name] on [DD Month YYYY] for [project].'),
      true
    );
  });
});
