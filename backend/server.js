import { createApp } from './src/app.js';
import { connectDatabase, disconnectDatabase } from './src/config/db.js';
import { env, assertProductionConfig } from './src/config/env.js';
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
