import { StoredFile } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Types a browser may render in place. Everything else downloads: a `.docx`
 * shown inline is a page of mojibake, and anything HTML-ish would run with this
 * origin's privileges.
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
 * Serves an uploaded artefact. Unauthenticated, as the static paths it replaces
 * were: the random token is the capability, so a link can be opened but not
 * guessed at.
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
  // URL cannot change.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  // These are files other people uploaded, served from the app's own origin.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(bytes);
});
