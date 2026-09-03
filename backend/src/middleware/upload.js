import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(here, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/json', '.json'],
  // The engine has always been able to read Markdown; only this door was shut.
  ['text/markdown', '.md'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) || path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

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
