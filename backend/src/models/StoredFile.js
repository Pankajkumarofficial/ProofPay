import crypto from 'node:crypto';
import mongoose from 'mongoose';

/** An uploaded artefact, kept in the database rather than on the filesystem. */
const storedFileSchema = new mongoose.Schema(
  {
    /** The public handle, deliberately not the `_id`. */
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
