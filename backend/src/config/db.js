import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let memoryServer = null;
/** Which database is actually being served. */
let mode = 'none';

export const databaseMode = () => mode;

/** How hard to try before giving up on MONGODB_URI. */
const CONNECT_ATTEMPTS = Math.max(1, Number(process.env.MONGO_CONNECT_ATTEMPTS) || 3);
const RETRY_PAUSE_MS = Math.max(0, Number(process.env.MONGO_RETRY_PAUSE_MS) || 2500);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connects to MongoDB. */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  // Injection is stopped at the edge instead.

  let failure = null;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 4000 });
      mode = 'primary';
      logger.info(`MongoDB connected → ${describeDatabase(env.mongoUri)}`);
      return mongoose.connection;
    } catch (error) {
      failure = error;
      if (attempt < CONNECT_ATTEMPTS) {
        logger.warn(
          `MongoDB attempt ${attempt}/${CONNECT_ATTEMPTS} failed; retrying in ${RETRY_PAUSE_MS / 1000}s.`
        );
        await pause(RETRY_PAUSE_MS);
      }
    }
  }

  {
    const error = failure;
    if (env.isDeployed || !env.allowMemoryDb) throw error;
    logger.warn(`MongoDB ${describeDatabase(env.mongoUri)} is unreachable (${error.message}).`);
    logger.warn('ALLOW_MEMORY_DB=true → starting an ephemeral local MongoDB instance.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'proofpay' } });
    await mongoose.connect(memoryServer.getUri('proofpay'));
    mode = 'ephemeral';
    // Said in as many words.
    logger.warn('SERVING AN EMPTY DATABASE — nothing written to it belongs to your real one,');
    logger.warn('and it is discarded when this process exits. Restart once MONGODB_URI is reachable.');
    // An Atlas cluster refuses an address that is not on its list.
    if (/whitelist|not allowed|IP address/i.test(error.message)) {
      logger.warn('Atlas says the connecting IP is not allowlisted — check Network Access in Atlas.');
    }
    return mongoose.connection;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  memoryServer = null;
}

/** What a connection log may say out loud. */
function describeDatabase(uri) {
  try {
    const parsed = new URL(uri);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    const host = parsed.hostname.endsWith('.mongodb.net')
      ? `Atlas/${parsed.hostname.split('.')[0]}`
      : parsed.hostname;
    return `${database} on ${host}`;
  } catch {
    // A malformed URI is worth saying so, but never worth echoing back.
    return '(MONGODB_URI could not be parsed)';
  }
}
