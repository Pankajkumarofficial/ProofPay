import { Router } from 'express';
import { razorpayWebhook } from '../controllers/webhookController.js';

/**
 * Unauthenticated by design: the caller is a payment provider, not a person,
 * and it proves itself with a signature over the body rather than a session.
 */
const router = Router();

router.post('/razorpay', razorpayWebhook);

export default router;
