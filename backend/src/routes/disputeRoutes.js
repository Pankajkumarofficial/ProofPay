import { Router } from 'express';
import * as disputes from '../controllers/disputeController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { proofEngineLimiter } from '../middleware/rateLimit.js';
import {
  createDisputeSchema,
  disputeClaimSchema,
  resolveDisputeSchema,
  idParam,
} from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.get('/', disputes.listDisputes);
router.post('/', validate({ body: createDisputeSchema }), disputes.createDispute);
router.get('/:id', validate({ params: idParam }), disputes.getDispute);
router.post('/:id/evidence', validate({ params: idParam, body: disputeClaimSchema }), disputes.addDisputeClaim);
router.post('/:id/analyze', proofEngineLimiter, validate({ params: idParam }), disputes.analyseDisputeCase);
router.post('/:id/resolve', validate({ params: idParam, body: resolveDisputeSchema }), disputes.resolveDispute);

export default router;
