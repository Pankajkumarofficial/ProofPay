import { Router } from 'express';
import * as conditions from '../controllers/conditionController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateConditionSchema, confirmConditionSchema, idParam } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.patch('/:id', validate({ params: idParam, body: updateConditionSchema }), conditions.updateCondition);
router.delete('/:id', validate({ params: idParam }), conditions.deleteCondition);
router.post(
  '/:id/confirm',
  validate({ params: idParam, body: confirmConditionSchema }),
  conditions.confirmCondition
);

export default router;
