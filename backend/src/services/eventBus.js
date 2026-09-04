import { EventEmitter } from 'node:events';

/** In-process fan-out for live updates. */
class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
eventBus.setMaxListeners(200);

export const CHANNEL = 'proofpay:update';

/**
 * @param {object} payload
 * @param {string[]} payload.userIds users whose screens should refresh
 * @param {string} payload.type      e.g. 'promise.updated'
 * @param {object} [payload.data]    small, non-sensitive hints for the client
 */
export function publishUpdate({ userIds = [], type, data = {} }) {
  const recipients = [...new Set(userIds.filter(Boolean).map(String))];
  if (!recipients.length) return;
  eventBus.emit(CHANNEL, { userIds: recipients, type, data, at: new Date().toISOString() });
}
