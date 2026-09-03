import { createApp } from './src/app.js';
import { connectDatabase, disconnectDatabase } from './src/config/db.js';
import { env, assertProductionConfig, googleCallbackIsRoutable, configNotices } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import { engineDescriptor } from './src/services/aiClient.js';
import { activePayoutProvider } from './src/services/payoutService.js';
import { settleAssessments } from './src/controllers/evidenceController.js';

async function start() {
  assertProductionConfig();
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`ProofPay API listening on http://localhost:${env.port}`);
    const engine = engineDescriptor();
    logger.info(
      `Proof Engine: ${engine.model ? `${engine.engine} (${engine.model})` : 'local deterministic engine'}`
    );
    logger.info(`Payments: ${env.payment.mode} mode`);
    logger.info(`Payouts: ${activePayoutProvider() ?? 'off'}`);
    logger.info(`Client origin: ${env.clientUrl}`);
    // A live host that never received NODE_ENV=production still hardens itself,
    // because `isDeployed` reads the platform rather than the variable — but the
    // variable being absent means the dashboard and render.yaml have diverged,
    // and that is worth saying out loud before something else depends on it.
    if (env.isDeployed && !env.isProd) {
      logger.warn(
        `NODE_ENV is "${env.nodeEnv}" on a public host. Hardening is on regardless, ` +
          'but set NODE_ENV=production — this service is not tracking render.yaml.'
      );
    }
    for (const notice of configNotices) logger.warn(notice);
    // The one value Google has to have registered verbatim. Printing it turns
    // "the button sends me somewhere else" into a line you can compare against
    // the Cloud Console without reading any of this code.
    logger.info(
      env.google.enabled
        ? `Google sign-in: on, redirecting to ${env.google.callbackUrl}`
        : 'Google sign-in: off (no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)'
    );
    // Production refuses to boot on this; development only says so, because a
    // half-configured optional feature is not a reason to withhold the app.
    if (env.google.enabled && !googleCallbackIsRoutable()) {
      logger.warn(
        `GOOGLE_CALLBACK_URL does not end in /api/auth/google/callback — Google sign-in cannot complete.`
      );
    }
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down.`);
    server.close(async () => {
      // A proof being read has no request behind it; finish the reading rather
      // than leave the record saying "being read" forever.
      await settleAssessments();
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  logger.error('ProofPay API failed to start:', error.message);
  logger.error(error.stack);
  process.exit(1);
});
