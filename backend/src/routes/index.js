import { Router } from 'express';
import authRoutes from './authRoutes.js';
import promiseRoutes from './promiseRoutes.js';
import conditionRoutes from './conditionRoutes.js';
import evidenceRoutes from './evidenceRoutes.js';
import disputeRoutes from './disputeRoutes.js';
import aiRoutes from './aiRoutes.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { analyticsQuery, idParam } from '../validators/schemas.js';
import { getDashboard, getPromiseSpace } from '../controllers/dashboardController.js';
import { getAnalytics } from '../controllers/analyticsController.js';
import { listChronicle } from '../controllers/chronicleController.js';
import { listNotifications, markRead, markAllRead } from '../controllers/notificationController.js';
import { stream } from '../controllers/streamController.js';
import { seedScenario } from '../controllers/demoController.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'proofpay-api',
      proofEngine: env.ai.enabled ? 'claude' : 'local-engine',
      paymentMode: env.payment.mode,
      time: new Date().toISOString(),
    },
  });
});

router.use('/auth', authRoutes);
router.use('/promises', promiseRoutes);
router.use('/conditions', conditionRoutes);
router.use('/evidence', evidenceRoutes);
router.use('/disputes', disputeRoutes);
router.use('/ai', aiRoutes);

router.get('/dashboard', requireAuth, getDashboard);
router.get('/promise-space', requireAuth, getPromiseSpace);
router.get('/analytics', requireAuth, validate({ query: analyticsQuery }), getAnalytics);
router.get('/chronicle', requireAuth, listChronicle);

router.get('/notifications', requireAuth, listNotifications);
router.patch('/notifications/read-all', requireAuth, markAllRead);
router.patch('/notifications/:id/read', requireAuth, validate({ params: idParam }), markRead);

router.get('/stream', requireAuth, stream);
router.post('/demo/scenario', requireAuth, seedScenario);

export default router;
