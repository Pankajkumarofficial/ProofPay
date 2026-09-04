import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  // The engine has always been able to read Markdown; only this door was shut.
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Held in memory, then written to the database by `storeUpload`. Never to disk:
 * this host empties its filesystem on every redeploy. The size limits below are
 * what keep that safe — one bounded buffer per request.
 */
const storage = multer.memoryStorage();

export const uploadProof = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(
        ApiError.badRequest(
          `That file type isn't accepted as proof. Allowed: images, PDF, documents, spreadsheets, CSV and text.`
        )
      );
      return;
    }
    cb(null, true);
  },
}).single('file');

/**
 * A profile picture, which is a different kind of upload from proof.
 *
 * Proof is an artefact of record and may be a PDF or a spreadsheet; a portrait
 * is only ever an image, and a small one. Sharing the proof limits would let a
 * 10MB scan become someone's avatar, so this carries its own.
 */
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const uploadAvatar = multer({
  storage,
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_TYPES.has(file.mimetype)) {
      cb(ApiError.badRequest('A profile picture has to be a PNG, JPEG, WebP or GIF image.'));
      return;
    }
    cb(null, true);
  },
}).single('avatar');

export const acceptAvatarFile = (req, res, next) =>
  uploadAvatar(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(
        ApiError.badRequest(
          `That image is larger than the ${MAX_AVATAR_BYTES / (1024 * 1024)}MB limit for a profile picture.`
        )
      );
    }
    return next(error instanceof ApiError ? error : ApiError.badRequest('That image could not be read.'));
  });

/** Wraps multer so its errors become friendly ApiErrors. */
export const acceptProofFile = (req, res, next) =>
  uploadProof(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(
        ApiError.badRequest(
          `That file is larger than the ${Math.round(env.maxUploadBytes / (1024 * 1024))}MB limit.`
        )
      );
    }
    return next(error instanceof ApiError ? error : ApiError.badRequest('That upload could not be read.'));
  });
