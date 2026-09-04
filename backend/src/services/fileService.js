import { StoredFile } from '../models/StoredFile.js';

/** The shape `fileUrl` takes for anything stored here. */
const FILE_PATH_PREFIX = '/api/files/';

/** Reads the handle back out of a stored `fileUrl`, or null if it is not one. */
export const tokenFromUrl = (fileUrl) =>
  typeof fileUrl === 'string' && fileUrl.startsWith(FILE_PATH_PREFIX)
    ? fileUrl.slice(FILE_PATH_PREFIX.length).split(/[?#]/)[0] || null
    : null;

/** Saves an uploaded file and returns the record that now owns its bytes. */
export async function storeUpload(file, userId = null) {
  if (!file?.buffer) return null;
  return StoredFile.create({
    data: file.buffer,
    contentType: file.mimetype,
    size: file.size,
    originalName: file.originalname ?? null,
    uploadedBy: userId,
  });
}

/**
 * The bytes behind a saved record, for the Proof Engine to re-read.
 *
 * Returns null rather than throwing when the file is missing — a proof filed
 * before uploads were durable has a `fileUrl` pointing at a filesystem that no
 * longer exists, and the engine's own fallback ("the artefact was not provided")
 * is a better answer there than a failed request.
 */
export async function loadStoredFile(fileUrl) {
  const token = tokenFromUrl(fileUrl);
  if (!token) return null;
  const stored = await StoredFile.findOne({ token }).lean();
  if (!stored?.data) return null;
  return {
    buffer: stored.data.buffer ? Buffer.from(stored.data.buffer) : Buffer.from(stored.data),
    contentType: stored.contentType,
    originalName: stored.originalName,
    size: stored.size,
  };
}

/** Removes a file nothing points at any more. Never fails the caller's request. */
export async function discardStoredFile(fileUrl) {
  const token = tokenFromUrl(fileUrl);
  if (!token) return;
  await StoredFile.deleteOne({ token }).catch(() => {});
}
