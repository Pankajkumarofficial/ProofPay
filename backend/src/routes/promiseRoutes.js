import { Router } from 'express';
import * as promises from '../controllers/promiseController.js';
import * as conditions from '../controllers/conditionController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createPromiseSchema,
  updatePromiseSchema,
  listPromisesQuery,
  createConditionSchema,
  fundPromiseSchema,
  verifyFundingSchema,
  payoutDestinationSchema,
  fulfilPromiseSchema,
  idParam,
} from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate({ query: listPromisesQuery }), promises.listPromises);
router.post('/', validate({ body: createPromiseSchema }), promises.createPromise);
router.get('/search', promises.searchPromises);

router.get('/:id', validate({ params: idParam }), promises.getPromise);
router.patch('/:id', validate({ params: idParam, body: updatePromiseSchema }), promises.updatePromise);
router.delete('/:id', validate({ params: idParam }), promises.cancelPromise);

router.post('/:id/fund', validate({ params: idParam, body: fundPromiseSchema }), promises.fundPromise);
router.post(
  '/:id/fund/verify',
  validate({ params: idParam, body: verifyFundingSchema }),
  promises.verifyFunding
);
router.post('/:id/fulfill', validate({ params: idParam, body: fulfilPromiseSchema }), promises.fulfilPromise);
router.post('/:id/recalculate', validate({ params: idParam }), promises.recalculate);

router.post(
  '/:id/payout-destination',
  validate({ params: idParam, body: payoutDestinationSchema }),
  promises.setPayoutDestination
);
router.post('/:id/payout/refresh', validate({ params: idParam }), promises.refreshPayoutStatus);

router.get('/:id/chronicle', validate({ params: idParam }), promises.promiseChronicle);
router.get('/:id/briefing', validate({ params: idParam }), promises.promiseBriefing);

router.get('/:id/conditions', validate({ params: idParam }), conditions.listConditions);
router.post(
  '/:id/conditions',
  validate({ params: idParam, body: createConditionSchema }),
  conditions.createCondition
);

export default router;
