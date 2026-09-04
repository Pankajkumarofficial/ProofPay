import { StoredFile } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Types a browser may render in place rather than download.
 *
 * Everything else is sent as an attachment. A `.docx` opened inline is a page
 * of mojibake, and an HTML-ish upload rendered on this origin would run with
 * this origin's privileges — so the list is what can be shown safely, not what
 * happens to be displayable.
 */
const INLINE = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

/** Keeps a filename usable in a header without letting it break out of one. */
const safeName = (name) => (name || 'proof').replace(/[^\w.\- ]+/g, '_').slice(0, 120);

/**
 * Serves an uploaded artefact from the database.
 *
 * Unauthenticated, exactly as the static `/uploads` paths it replaces were: the
 * 32-character random token is the capability. Anyone holding a link can open
 * the file, and nobody can enumerate their way to one.
 */
export const getFile = asyncHandler(async (req, res) => {
  const stored = await StoredFile.findOne({ token: req.params.token }).lean();
  if (!stored?.data) throw ApiError.notFound('That file is no longer stored.');

  const bytes = Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data.buffer ?? stored.data);
  const disposition = INLINE.has(stored.contentType) ? 'inline' : 'attachment';

  res.setHeader('Content-Type', stored.contentType);
  res.setHeader('Content-Length', bytes.byteLength);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName(stored.originalName)}"`);
  // The token names these exact bytes and is never reused, so the file behind a
  // URL cannot change. A year is safe, and it keeps a re-read of a promise from
  // pulling every attachment down again.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  // Belt and braces: these are files other people uploaded, served from the
  // origin the app itself runs on.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(bytes);
});
