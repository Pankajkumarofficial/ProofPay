import crypto from 'node:crypto';
import mongoose from 'mongoose';

/**
 * An uploaded artefact, kept in the database rather than on the filesystem.
 *
 * The disk under a free Render instance is wiped on every redeploy and every
 * wake from idle, while the Evidence row describing the file survives here — so
 * the vault went on rendering proof, its size and the engine's reading of it,
 * hours after the file itself was gone. See incident 7.
 *
 * Its own collection, so listing the vault never drags a megabyte of PDF
 * through the query. `MAX_UPLOAD_MB` keeps a document inside Mongo's 16MB
 * ceiling.
 */
const storedFileSchema = new mongoose.Schema(
  {
    /**
     * The public handle, deliberately not the `_id`: an ObjectId is a timestamp
     * and a counter, so its neighbours are guessable. These URLs are
     * unauthenticated, exactly as the static paths they replace were, which
     * makes the unguessable name the only thing protecting them.
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
