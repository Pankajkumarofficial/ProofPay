import { asyncHandler } from '../utils/asyncHandler.js';
import { verifySignature, applyWebhookEvent } from '../services/webhookService.js';
import { logger } from '../utils/logger.js';

/**
 * The provider's own account of what happened to the money.
 *
 * Answers 200 to anything it verified, including events it chose not to act on.
 * A provider reads a non-2xx as "not delivered" and retries — for days — so
 * returning an error for an event that is simply old, duplicated, or about a
 * promise this instance has never seen would earn an unending redelivery loop.
 *
 * A bad signature is the exception: that is not a delivery problem, it is
 * somebody else posting, and it is refused.
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  // express.raw leaves the exact bytes here, which is what was signed.
  verifySignature(req.body, req.get('x-razorpay-signature'));

  const parsed = JSON.parse(req.body.toString('utf8'));
  const eventId = req.get('x-razorpay-event-id') ?? parsed.id ?? null;

  const result = await applyWebhookEvent({
    event: parsed.event,
    payload: parsed.payload,
    eventId,
  });

  if (!result.handled) {
    logger.info(`Webhook ${parsed.event} not applied: ${result.reason}.`);
  }

  res.json({ success: true, data: { received: true, ...result } });
});
