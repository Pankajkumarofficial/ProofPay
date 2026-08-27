import { Notification } from '../models/index.js';
import { publishUpdate } from './eventBus.js';
import { logger } from '../utils/logger.js';

/** Creates notifications for a set of users and nudges their open sessions. */
export async function notify({ users = [], promise = null, type, title, body = '', severity = 'info' }) {
  const recipients = [...new Set(users.filter(Boolean).map((user) => String(user._id ?? user)))];
  if (!recipients.length) return [];
  try {
    const created = await Notification.insertMany(
      recipients.map((user) => ({
        user,
        promise: promise?._id ?? promise ?? null,
        type,
        title,
        body,
        severity,
      }))
    );
    publishUpdate({ userIds: recipients, type: 'notification.created', data: { promiseId: promise?._id?.toString() } });
    return created;
  } catch (error) {
    logger.error('Notification write failed', error.message);
    return [];
  }
}

/** Everyone with a stake in a promise: the payer, the recipient, any witness. */
export function stakeholderIds(promise) {
  return [
    promise.payer?._id ?? promise.payer,
    promise.recipient?.user,
    ...(promise.participants || []).map((participant) => participant.user),
  ].filter(Boolean);
}
