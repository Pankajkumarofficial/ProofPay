import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let memoryServer = null;
/**
 * Which database is actually being served: the one in MONGODB_URI, or a
 * throwaway one started because that was unreachable. Reported on /health,
 * because an empty ephemeral database looks exactly like lost data from the
 * interface, and the difference matters more than any other fact about a run.
 */
let mode = 'none';

export const databaseMode = () => mode;

/**
 * How hard to try before giving up on MONGODB_URI.
 *
 * One four-second attempt is not enough to tell "the database is gone" from
 * "the wifi blinked" — and on a home connection behind an Atlas IP allowlist,
 * the second is far more common. Getting this wrong is expensive in a specific
 * way: the fallback below serves an empty database, which reads as every
 * promise having vanished.
 */
const CONNECT_ATTEMPTS = Math.max(1, Number(process.env.MONGO_CONNECT_ATTEMPTS) || 3);
const RETRY_PAUSE_MS = Math.max(0, Number(process.env.MONGO_RETRY_PAUSE_MS) || 2500);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connects to MongoDB.
 *
 * Primary path is MONGODB_URI, retried a few times before it is believed. If it
 * is still unreachable and ALLOW_MEMORY_DB is on (development convenience only),
 * an ephemeral local mongod is started so the stack still runs end-to-end on a
 * machine with no MongoDB installed. Either way the application only ever talks
 * to a real MongoDB server through Mongoose.
 */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  // Injection is stopped at the edge instead: sanitizeRequest strips operator
  // keys from every request, and Zod re-types what survives. Mongoose's global
  // sanitizeFilter would also neuter the operators this app's own queries rely on.

  let failure = null;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 4000 });
      mode = 'primary';
      logger.info(`MongoDB connected → ${redact(env.mongoUri)}`);
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
    if (env.isProd || !env.allowMemoryDb) throw error;
    logger.warn(`MongoDB at ${redact(env.mongoUri)} is unreachable (${error.message}).`);
    logger.warn('ALLOW_MEMORY_DB=true → starting an ephemeral local MongoDB instance.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'proofpay' } });
    await mongoose.connect(memoryServer.getUri('proofpay'));
    mode = 'ephemeral';
    // Said in as many words: from here the app works perfectly and shows nobody
    // their promises, which reads as data loss rather than as a failed
    // connection. Set ALLOW_MEMORY_DB=false to fail loudly here instead.
    logger.warn('SERVING AN EMPTY DATABASE — nothing written to it belongs to your real one,');
    logger.warn('and it is discarded when this process exits. Restart once MONGODB_URI is reachable.');
    // An Atlas cluster refuses an address that is not on its list, and a home
    // connection is handed a new one regularly. Naming it here saves working
    // back from "all my promises are gone" to a network setting.
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

function redact(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:*****@');
}
