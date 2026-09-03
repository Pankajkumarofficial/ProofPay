// @ts-check
/**
 * The words inside an Office file — Word (.docx) and Excel (.xlsx).
 *
 * Both are ZIPs of XML parts, so nothing reads them as bytes: neither is text
 * the way a .txt is, nor something a model can look at the way it looks at a
 * screenshot. Handed to the Proof Engine unopened, one arrives as a *filename*,
 * the engine caps its confidence because the contents were not provided, and
 * the interface shows a reading of a document nobody opened.
 *
 * That is incident 1 repeating — images, then links, then Word files, then
 * spreadsheets — and the shape is always the same: an artefact the pipeline
 * cannot turn into something the engine can read, refused for a reason that
 * sounds like a judgement on its contents. So the words come out on this side,
 * and travel as text to every provider.
 *
 * This reads the archive directly rather than taking a dependency: the only
 * parts that matter are `word/document.xml` and the worksheet XML, and stored
 * or deflated entries are all an Office file ever uses.
 */
import zlib from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The largest trailing comment a ZIP may carry, so the EOCD scan is bounded. */
const MAX_COMMENT = 0xffff;

/**
 * The parts worth reading, in the order their text should appear. Body first;
 * headers and footers carry letterheads and signature blocks, which is often
 * where an approval actually lives.
 */
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Locates the end-of-central-directory record, which is the only fixed anchor. */
function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - MAX_COMMENT - 22);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Every entry in the archive, as {name, compressionMethod, compressedSize,
 * localHeaderOffset}. Reads the central directory rather than walking local
 * headers, because only the central directory states sizes reliably.
 */
function readCentralDirectory(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return [];

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    entries.push({
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
      compressionMethod: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One entry's bytes, decompressed. Null when it is stored in a way we cannot read. */
function readEntry(buffer, entry) {
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length) return null;
  if (buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) return null;

  // The local header repeats the name and extra fields, and its extra field
  // length may differ from the central one — so the data offset is computed
  // from the local header, and only the size is taken from the central record.
  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) return null;

  const compressed = buffer.subarray(start, end);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) {
    try {
      return zlib.inflateRawSync(compressed);
    } catch {
      return null;
    }
  }
  return null;
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** XML character references and the five named entities, as their characters. */
const decodeEntities = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]);

/**
 * WordprocessingML to plain text.
 *
 * Paragraph and row boundaries become newlines and tabs become tabs, because a
 * signature block or an approval table read as one run-on line loses the very
 * structure that makes it legible as an approval.
 */
function xmlToText(xml) {
  return (
    xml
      // Structure first, while the tags are still there to read.
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      // Then everything else goes.
      .replace(/<[^>]+>/g, '')
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity])
      .replace(/[ \t]+$/gm, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * The readable text of a .docx, or null when there is none to read.
 *
 * Null rather than '' throughout: an empty string reads as "this document is
 * blank", which is a claim about the artefact. Null says only that nothing was
 * extracted, which is the truth when a file is corrupt, encrypted, or a scan.
 *
 * @param {Buffer} buffer the raw .docx bytes
 * @returns {string | null}
 */
export function extractDocxText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return null;
  // Every ZIP starts with a local file header; anything else is not one.
  if (buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) return null;

  const parts = readCentralDirectory(buffer)
    .filter((entry) => TEXT_PARTS.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const documentFirst = [
    ...parts.filter((entry) => entry.name === 'word/document.xml'),
    ...parts.filter((entry) => entry.name !== 'word/document.xml'),
  ];

  const text = documentFirst
    .map((entry) => readEntry(buffer, entry))
    .filter((bytes) => bytes !== null)
    .map((bytes) => xmlToText(bytes.toString('utf8')))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return text || null;
}

/* ───────────────────────────── spreadsheets ───────────────────────────── */

const SHARED_STRINGS = 'xl/sharedStrings.xml';
const WORKSHEET = /^xl\/worksheets\/sheet\d*\.xml$/;

/**
 * A spreadsheet stores most of its text once, in a shared table, and its cells
 * hold indexes into it — so a sheet read on its own is mostly numbers. This is
 * that table, in order.
 */
function readSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    // One entry may be split across several runs when part of it is styled.
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((run) => decodeEntities(run[1]))
      .join('')
  );
}

/** One worksheet as tab-separated rows, so a table stays a table. */
function sheetToText(xml, sharedStrings) {
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const [, attributes, body] = cellMatch;
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];

      if (type === 'inlineStr') {
        const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((run) => decodeEntities(run[1]))
          .join('');
        cells.push(inline);
        continue;
      }

      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (value === undefined) {
        cells.push('');
        continue;
      }
      // 's' means the value is an index into the shared table, not the text.
      cells.push(type === 's' ? (sharedStrings[Number(value)] ?? '') : decodeEntities(value));
    }

    // A row of nothing but empty cells carries no information, and a wall of
    // blank lines makes the rest harder to read.
    if (cells.some((cell) => cell !== '')) rows.push(cells.join('\t'));
  }

  return rows.join('\n');
}

/**
 * The readable text of an .xlsx, or null when there is none to read.
 *
 * Formulas are not evaluated: what is returned is the value the spreadsheet
 * last stored for a cell, which is what the file itself would show. A sheet
 * that has never been opened by Excel may therefore have no values at all, and
 * that reads as nothing extracted rather than as an empty spreadsheet.
 *
 * @param {Buffer} buffer the raw .xlsx bytes
 * @returns {string | null}
 */
export function extractXlsxText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return null;
  if (buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) return null;

  const entries = readCentralDirectory(buffer);
  const read = (entry) => {
    const bytes = entry ? readEntry(buffer, entry) : null;
    return bytes ? bytes.toString('utf8') : null;
  };

  const sharedStrings = readSharedStrings(read(entries.find((entry) => entry.name === SHARED_STRINGS)));

  const text = entries
    .filter((entry) => WORKSHEET.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((entry) => read(entry))
    .filter(Boolean)
    .map((xml) => sheetToText(xml, sharedStrings))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return text || null;
}
