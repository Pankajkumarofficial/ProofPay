#!/usr/bin/env node
/**
 * A local MongoDB for machines that don't have one installed.
 *
 *   npm run mongo
 *
 * Starts a real mongod (the binary mongodb-memory-server manages) on port 27017
 * with a persistent data directory at backend/.mongo-data, so `npm run seed` and
 * the API share one database and data survives restarts. If you already run
 * MongoDB locally or use Atlas, ignore this script and point MONGODB_URI at it.
 */
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '../.mongo-data');
const port = Number(process.env.LOCAL_MONGO_PORT) || 27017;

const portInUse = () =>
  new Promise((resolve) => {
    const socket = net
      .connect({ port, host: '127.0.0.1' })
      .on('connect', () => (socket.end(), resolve(true)))
      .on('error', () => resolve(false));
    socket.setTimeout(1200, () => (socket.destroy(), resolve(false)));
  });

if (await portInUse()) {
  console.log(`MongoDB is already listening on 127.0.0.1:${port} — nothing to start.`);
  process.exit(0);
}

fs.mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  instance: { port, dbPath, storageEngine: 'wiredTiger' },
});

console.log(`\n  MongoDB running at ${server.getUri('proofpay')}`);
console.log(`  Data directory: ${dbPath}`);
console.log('  Leave this running, then use `npm run seed` and `npm run dev`.\n');

const stop = async () => {
  console.log('\nStopping MongoDB…');
  await server.stop({ doCleanup: false, force: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
