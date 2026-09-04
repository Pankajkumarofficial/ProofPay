import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

/** Writes one Chronicle entry. */
export async function recordAudit({
  user = null,
  actorName,
  promise = null,
  action,
  summary = '',
  entity = undefined,
  metadata = {},
  ip = null,
}) {
  try {
    return await AuditLog.create({
      user: user?._id ?? user ?? null,
      actorName: actorName ?? user?.name ?? 'System',
      promise: promise?._id ?? promise ?? null,
      action,
      summary,
      entity,
      metadata,
      ip,
    });
  } catch (error) {
    logger.error('Chronicle write failed', error.message);
    return null;
  }
}
