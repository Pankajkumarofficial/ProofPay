import { asyncHandler } from '../utils/asyncHandler.js';
import { verifySignature, applyWebhookEvent } from '../services/webhookService.js';
import { logger } from '../utils/logger.js';

/** The provider's own account of what happened to the money. */
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
