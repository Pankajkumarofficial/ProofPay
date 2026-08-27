import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let memoryServer = null;

/**
 * Connects to MongoDB.
 *
 * Primary path is MONGODB_URI. If that is unreachable and ALLOW_MEMORY_DB is on
 * (development convenience only), an ephemeral local mongod is started so the
 * stack still runs end-to-end on a machine with no MongoDB installed. Either way
 * the application only ever talks to a real MongoDB server through Mongoose.
 */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  // Injection is stopped at the edge instead: sanitizeRequest strips operator
  // keys from every request, and Zod re-types what survives. Mongoose's global
  // sanitizeFilter would also neuter the operators this app's own queries rely on.

  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 4000 });
    logger.info(`MongoDB connected → ${redact(env.mongoUri)}`);
    return mongoose.connection;
  } catch (error) {
    if (env.isProd || !env.allowMemoryDb) throw error;
    logger.warn(`MongoDB at ${redact(env.mongoUri)} is unreachable (${error.message}).`);
    logger.warn('ALLOW_MEMORY_DB=true → starting an ephemeral local MongoDB instance.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'proofpay' } });
    await mongoose.connect(memoryServer.getUri('proofpay'));
    logger.info('MongoDB connected → ephemeral instance (data resets on restart).');
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
