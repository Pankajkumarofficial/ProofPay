import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp, stopTestApp, client, fundedPromise } from './helpers.js';

/** Whether an uploaded artefact is still there afterwards. */

/** Where uploads used to be written, and must never be written again. */
const UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads');

let api;
let StoredFile;

before(async () => {
  api = await startTestApp();
  ({ StoredFile } = await import('../src/models/index.js'));
});
after(stopTestApp);

const countFilesOnDisk = () => {
  try {
    return fs.readdirSync(UPLOAD_DIR).length;
  } catch {
    return 0;
  }
};

/** A signed-in payer with a funded promise and one open condition. */
async function payerWithPromise() {
  const person = client(api);
  await person.signUp();
  const { promise, conditionId } = await fundedPromise(person);
  return { person, promise, conditionId };
}

describe('an uploaded artefact', () => {
  test('is stored in the database, not on a filesystem that gets wiped', async () => {
    const { person, promise, conditionId } = await payerWithPromise();
    const bytes = Buffer.from('Signed and delivered on the agreed date.\n', 'utf8');
    const before = countFilesOnDisk();

    const filed = await person.upload('/evidence', {
      fields: { promiseId: promise._id, conditionId, type: 'document', title: 'Completion note', autoVerify: 'false' },
      file: { name: 'completion.txt', contentType: 'text/plain', bytes },
    });

    assert.equal(filed.status, 201, JSON.stringify(filed.body));
    const { evidence } = filed.body.data;

    assert.match(evidence.fileUrl, /^\/api\/files\/[a-f0-9]{32}$/);
    assert.equal(countFilesOnDisk(), before, 'the upload must not have been written to disk');
    assert.equal(await StoredFile.countDocuments({}), 1);
  });

  test('comes back byte for byte, with its own content type', async () => {
    const { person, promise, conditionId } = await payerWithPromise();
    // A PNG header, so this is binary rather than something text-safe.
    const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452deadbeef', 'hex');

    const filed = await person.upload('/evidence', {
      fields: { promiseId: promise._id, conditionId, type: 'image', title: 'Screenshot', autoVerify: 'false' },
      file: { name: 'transfer.png', contentType: 'image/png', bytes },
    });
    assert.equal(filed.status, 201, JSON.stringify(filed.body));

    const served = await person.fetchFile(filed.body.data.evidence.fileUrl);
    assert.equal(served.status, 200);
    assert.equal(served.contentType, 'image/png');
    assert.deepEqual(served.bytes, bytes, 'the bytes served must be the bytes uploaded');
    // An image is meant to be looked at in the vault, not downloaded first.
    assert.match(served.disposition, /^inline;/);
  });

  test('is opened and read, so the engine judges contents rather than a file name', async () => {
    const { person, promise, conditionId } = await payerWithPromise();
    const words = 'The website was delivered on 3 March and all five acceptance tests passed.';

    const filed = await person.upload('/evidence', {
      fields: { promiseId: promise._id, conditionId, type: 'document', title: 'Handover', autoVerify: 'false' },
      file: { name: 'handover.txt', contentType: 'text/plain', bytes: Buffer.from(words, 'utf8') },
    });

    // `extractedChars` is only recorded when the artefact's text was actually pulled out of the bytes.
    assert.equal(filed.body.data.evidence.metadata.extractedChars, words.length);
  });

  test('that is a type no browser can render is sent as a download', async () => {
    const { person, promise, conditionId } = await payerWithPromise();
    const filed = await person.upload('/evidence', {
      fields: { promiseId: promise._id, conditionId, type: 'document', title: 'Contract', autoVerify: 'false' },
      file: {
        name: 'contract.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: Buffer.from('PK not really a docx', 'utf8'),
      },
    });
    assert.equal(filed.status, 201, JSON.stringify(filed.body));

    const served = await person.fetchFile(filed.body.data.evidence.fileUrl);
    assert.equal(served.status, 200);
    assert.match(served.disposition, /^attachment;/);
  });

  test('cannot be reached by guessing at a neighbour of a real one', async () => {
    const { person } = await payerWithPromise();
    const served = await person.fetchFile(`/api/files/${'0'.repeat(32)}`);
    assert.equal(served.status, 404);
  });

  test('goes with the proof when the proof is withdrawn', async () => {
    const { person, promise, conditionId } = await payerWithPromise();
    const filed = await person.upload('/evidence', {
      fields: { promiseId: promise._id, conditionId, type: 'document', title: 'Draft', autoVerify: 'false' },
      file: { name: 'draft.txt', contentType: 'text/plain', bytes: Buffer.from('a draft', 'utf8') },
    });
    const { evidence } = filed.body.data;
    const stored = await StoredFile.countDocuments({});

    const withdrawn = await person.call(`/evidence/${evidence._id}`, { method: 'DELETE' });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));

    assert.equal(await StoredFile.countDocuments({}), stored - 1, 'the bytes must not outlive the record');
    assert.equal((await person.fetchFile(evidence.fileUrl)).status, 404);
  });
});
