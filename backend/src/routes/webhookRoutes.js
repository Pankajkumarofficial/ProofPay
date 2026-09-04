import { Router } from 'express';
import { razorpayWebhook } from '../controllers/webhookController.js';

/** Unauthenticated by design. */
const router = Router();

router.post('/razorpay', razorpayWebhook);

export default router;
