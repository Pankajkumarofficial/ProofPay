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
import { getFile } from '../controllers/fileController.js';
import { env } from '../config/env.js';
import { databaseMode } from '../config/db.js';
import { engineDescriptor } from '../services/aiClient.js';
import { activePayoutProvider } from '../services/payoutService.js';
import { mailTransport } from '../services/mailService.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'proofpay-api',
      // 'ephemeral' means MONGODB_URI was unreachable at startup and this API is serving a throwaway.
      database: databaseMode(),
      proofEngine: engineDescriptor().engine,
      proofEngineModel: engineDescriptor().model,
      paymentMode: env.payment.mode,
      // Reported so "why is there no QR?" is answerable without reading .env.
      payoutProvider: activePayoutProvider() ?? 'none',
      // "smtp" on a free Render instance means blocked, not working: outbound
      // 25/465/587 are closed there, so the route matters, not just the config.
      mail: mailTransport(),
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

// Uploaded artefacts.
router.get('/files/:token([a-f0-9]{32})', getFile);

router.get('/stream', requireAuth, stream);
router.post('/demo/scenario', requireAuth, seedScenario);

export default router;
