import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractDocxText, extractXlsxText } from '../src/utils/ooxml.js';

/**
 * Builds a real .docx-shaped ZIP in memory: local headers, deflated entries and
 * a central directory. Writing one by hand rather than committing a binary
 * fixture keeps what is being asserted visible in the test.
 */
function buildDocx(parts) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, xml] of Object.entries(parts)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(Buffer.from(xml, 'utf8'));

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(Buffer.byteLength(xml), 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(Buffer.byteLength(xml), 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + deflated.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(parts).length, 8);
  eocd.writeUInt16LE(Object.keys(parts).length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

const paragraph = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('a Word file reaches the engine as its words, not its file name', async (t) => {
  await t.test('the body text comes out', () => {
    const docx = buildDocx({
      'word/document.xml': `<w:document><w:body>${paragraph('Client approval granted')}${paragraph(
        'Invoice INV-2291 settled'
      )}</w:body></w:document>`,
    });

    const text = extractDocxText(docx);
    assert.match(text, /Client approval granted/);
    assert.match(text, /Invoice INV-2291 settled/);
  });

  await t.test('paragraphs stay on separate lines', () => {
    const docx = buildDocx({
      'word/document.xml': `<w:body>${paragraph('Approved by')}${paragraph('Pankaj')}</w:body>`,
    });

    // An approval block read as one run-on line loses the structure that makes
    // it legible as an approval.
    assert.equal(extractDocxText(docx), 'Approved by\nPankaj');
  });

  await t.test('table cells are separated, so a two-column form does not merge', () => {
    const docx = buildDocx({
      'word/document.xml':
        '<w:body><w:tr><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>1500</w:t></w:r></w:p></w:tc></w:tr></w:body>',
    });

    assert.match(extractDocxText(docx), /Amount\s+1500/);
  });

  await t.test('headers and footers are read, because approvals are signed there', () => {
    const docx = buildDocx({
      'word/document.xml': `<w:body>${paragraph('Work completed.')}</w:body>`,
      'word/header1.xml': `<w:hdr>${paragraph('ACME Consulting')}</w:hdr>`,
      'word/footer1.xml': `<w:ftr>${paragraph('Signed: R. Sharma')}</w:ftr>`,
    });

    const text = extractDocxText(docx);
    assert.match(text, /Signed: R\. Sharma/);
    // The body leads; letterheads and signature blocks follow it.
    assert.ok(text.indexOf('Work completed.') < text.indexOf('ACME Consulting'));
  });

  await t.test('XML entities are decoded rather than shown raw', () => {
    const docx = buildDocx({
      'word/document.xml': `<w:body>${paragraph('Paid &amp; approved &#8212; in full')}</w:body>`,
    });

    assert.equal(extractDocxText(docx), 'Paid & approved — in full');
  });

  await t.test('a document with no readable text returns null, not an empty string', () => {
    // Null says "nothing was extracted". '' would say "this document is blank",
    // which is a claim about the artefact that a scan or a corrupt file has not
    // earned.
    const docx = buildDocx({ 'word/document.xml': '<w:body></w:body>' });
    assert.equal(extractDocxText(docx), null);
  });

  await t.test('something that is not a Word file is refused rather than guessed at', () => {
    assert.equal(extractDocxText(Buffer.from('%PDF-1.7 not a docx at all')), null);
    assert.equal(extractDocxText(Buffer.alloc(0)), null);
    // @ts-expect-error deliberately wrong type
    assert.equal(extractDocxText(null), null);
  });

  await t.test('a truncated archive does not throw', () => {
    const docx = buildDocx({ 'word/document.xml': `<w:body>${paragraph('Approved')}</w:body>` });
    assert.doesNotThrow(() => extractDocxText(docx.subarray(0, docx.length - 40)));
  });
});

const sheet = (rows) =>
  `<worksheet><sheetData>${rows
    .map(
      (cells, rowIndex) =>
        `<row r="${rowIndex + 1}">${cells
          .map(([type, value], cellIndex) =>
            type === null
              ? `<c r="${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}"/>`
              : `<c r="${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}"${
                  type ? ` t="${type}"` : ''
                }>${value}</c>`
          )
          .join('')}</row>`
    )
    .join('')}</sheetData></worksheet>`;

const shared = (values) =>
  `<sst>${values.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`;

test('a spreadsheet reaches the engine as its cells, not its file name', async (t) => {
  await t.test('shared strings are resolved back into the cells that point at them', () => {
    const xlsx = buildDocx({
      'xl/sharedStrings.xml': shared(['Invoice', 'INV-2291', 'Status', 'Paid']),
      'xl/worksheets/sheet1.xml': sheet([
        [['s', '<v>0</v>'], ['s', '<v>1</v>']],
        [['s', '<v>2</v>'], ['s', '<v>3</v>']],
      ]),
    });

    // Without the shared table this reads as "0\t1\n2\t3" — numbers that mean
    // nothing, which is exactly how a spreadsheet looks to anything that does
    // not know the indirection is there.
    assert.equal(extractXlsxText(xlsx), 'Invoice\tINV-2291\nStatus\tPaid');
  });

  await t.test('numbers keep their values', () => {
    const xlsx = buildDocx({
      'xl/sharedStrings.xml': shared(['Amount']),
      'xl/worksheets/sheet1.xml': sheet([[['s', '<v>0</v>'], ['', '<v>1500.5</v>']]]),
    });

    assert.equal(extractXlsxText(xlsx), 'Amount\t1500.5');
  });

  await t.test('an inline string is read without a shared table', () => {
    const xlsx = buildDocx({
      'xl/worksheets/sheet1.xml': sheet([[['inlineStr', '<is><t>Approved</t></is>']]]),
    });

    assert.equal(extractXlsxText(xlsx), 'Approved');
  });

  await t.test('every sheet is read, in order', () => {
    const xlsx = buildDocx({
      'xl/sharedStrings.xml': shared(['first sheet', 'second sheet']),
      'xl/worksheets/sheet1.xml': sheet([[['s', '<v>0</v>']]]),
      'xl/worksheets/sheet2.xml': sheet([[['s', '<v>1</v>']]]),
    });

    assert.equal(extractXlsxText(xlsx), 'first sheet\n\nsecond sheet');
  });

  await t.test('sheet 10 sorts after sheet 2, not between 1 and 2', () => {
    const xlsx = buildDocx({
      'xl/sharedStrings.xml': shared(['one', 'two', 'ten']),
      'xl/worksheets/sheet1.xml': sheet([[['s', '<v>0</v>']]]),
      'xl/worksheets/sheet2.xml': sheet([[['s', '<v>1</v>']]]),
      'xl/worksheets/sheet10.xml': sheet([[['s', '<v>2</v>']]]),
    });

    assert.equal(extractXlsxText(xlsx), 'one\n\ntwo\n\nten');
  });

  await t.test('a row of empty cells is dropped rather than left as a blank line', () => {
    const xlsx = buildDocx({
      'xl/sharedStrings.xml': shared(['Total']),
      'xl/worksheets/sheet1.xml': sheet([
        [[null, ''], [null, '']],
        [['s', '<v>0</v>']],
      ]),
    });

    assert.equal(extractXlsxText(xlsx), 'Total');
  });

  await t.test('an empty sheet returns null, not an empty string', () => {
    const xlsx = buildDocx({ 'xl/worksheets/sheet1.xml': sheet([]) });
    assert.equal(extractXlsxText(xlsx), null);
  });

  await t.test('a Word file is not mistaken for a spreadsheet', () => {
    const docx = buildDocx({
      'word/document.xml': `<w:body>${paragraph('Approved')}</w:body>`,
    });
    assert.equal(extractXlsxText(docx), null);
    assert.equal(extractDocxText(docx), 'Approved');
  });
});
