import { PromiseModel } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Loads a promise the authenticated user is actually entitled to see. Every
 * controller goes through here, so authorisation is never a per-route decision
 * and a client-supplied user id is never trusted.
 */
export async function loadPromiseForUser(promiseId, user, { mustBePayer = false } = {}) {
  const promise = await PromiseModel.findOne({
    _id: promiseId,
    ...PromiseModel.visibilityFilter(user),
  });
  if (!promise) throw ApiError.notFound('That promise does not exist, or is not yours to view.');
  if (mustBePayer && String(promise.payer) !== String(user._id)) {
    throw ApiError.forbidden('Only the payer can do that on this promise.');
  }
  return promise;
}

export const isPayer = (promise, user) => String(promise.payer) === String(user._id);

export function relationTo(promise, user) {
  if (isPayer(promise, user)) return 'payer';
  if (
    String(promise.recipient?.user ?? '') === String(user._id) ||
    (promise.recipient?.email && promise.recipient.email === user.email)
  ) {
    return 'recipient';
  }
  return 'participant';
}
