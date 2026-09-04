import crypto from 'node:crypto';
import mongoose from 'mongoose';

/**
 * An uploaded artefact, kept in the database rather than on the filesystem.
 *
 * The disk under a free Render instance is ephemeral: every redeploy, and every
 * wake from the 15-minute idle sleep, starts with an empty `backend/uploads`.
 * The Evidence rows survived that, because they are here — so the vault kept
 * rendering a proof, its size, and the engine's reading of it, while the file
 * behind the link had been gone for hours. A product whose whole claim is that
 * evidence can be produced on demand cannot lose the evidence.
 *
 * So the bytes live where the record lives. Uploads are capped at 10MB
 * (`MAX_UPLOAD_MB`), comfortably inside MongoDB's 16MB document ceiling, and
 * the collection is separate from Evidence so that listing the vault never
 * drags a megabyte of PDF through the query.
 */
const storedFileSchema = new mongoose.Schema(
  {
    /**
     * The public handle, and deliberately not the `_id`.
     *
     * An ObjectId is a timestamp, a machine identifier and a counter — given
     * one, its neighbours are guessable, and these URLs are unauthenticated
     * exactly as the static `/uploads` paths they replace were. 16 random bytes
     * restore the property the old `Date.now()-<hex>` filenames had.
     */
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => crypto.randomBytes(16).toString('hex'),
    },

    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    originalName: { type: String, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/** Where the browser fetches this file from. Stored on the record that owns it. */
storedFileSchema.methods.publicPath = function publicPath() {
  return `/api/files/${this.token}`;
};

export const StoredFile = mongoose.model('StoredFile', storedFileSchema);
