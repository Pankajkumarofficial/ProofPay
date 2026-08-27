import { Router } from 'express';
import * as evidence from '../controllers/evidenceController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { acceptProofFile } from '../middleware/upload.js';
import { uploadLimiter, proofEngineLimiter } from '../middleware/rateLimit.js';
import { createEvidenceSchema, listEvidenceQuery, idParam } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate({ query: listEvidenceQuery }), evidence.listEvidence);
router.post(
  '/',
  uploadLimiter,
  acceptProofFile, // multipart or JSON both land in req.body
  validate({ body: createEvidenceSchema }),
  evidence.createEvidence
);
router.get('/:id', validate({ params: idParam }), evidence.getEvidence);
router.post('/:id/verify', proofEngineLimiter, validate({ params: idParam }), evidence.verifyEvidence);
router.delete('/:id', validate({ params: idParam }), evidence.deleteEvidence);

export default router;
