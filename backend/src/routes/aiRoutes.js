import { Router } from 'express';
import * as ai from '../controllers/aiController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { proofEngineLimiter } from '../middleware/rateLimit.js';
import {
  parsePromiseSchema,
  analyzeEvidenceSchema,
  detectAmbiguitySchema,
  analyzeDisputeSchema,
} from '../validators/schemas.js';

const router = Router();
router.use(requireAuth, proofEngineLimiter);

router.get('/status', ai.engineStatus);
router.post('/parse-promise', validate({ body: parsePromiseSchema }), ai.parsePromise);
router.post('/detect-ambiguity', validate({ body: detectAmbiguitySchema }), ai.detectAmbiguity);
router.post('/analyze-evidence', validate({ body: analyzeEvidenceSchema }), ai.analyzeEvidence);
router.post('/analyze-dispute', validate({ body: analyzeDisputeSchema }), ai.analyzeDispute);

export default router;
