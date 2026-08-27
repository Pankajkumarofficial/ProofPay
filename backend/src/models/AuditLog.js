import mongoose from 'mongoose';
import { AUDIT_ACTION } from './constants.js';

/** The Chronicle. Append-only: nothing in the API ever updates or deletes these. */
const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, default: 'System' },
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', default: null, index: true },
    action: { type: String, enum: Object.values(AUDIT_ACTION), required: true, index: true },
    summary: { type: String, default: '' },
    entity: {
      type: { type: String, default: null },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ promise: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
