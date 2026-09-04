#!/usr/bin/env node
/** Runs the API and the Vite dev server together, with no extra dependencies. */
import net from 'node:net';
import { spawn } from 'node:child_process';

const API_PORT = Number(process.env.PORT) || 5050;
/** Long enough to cover a slow database connection, short enough to not hang. */
const API_WAIT_MS = 40000;

const targets = [
  { name: 'api', color: '\x1b[38;5;179m', cwd: 'backend', args: ['run', 'dev'] },
  { name: 'web', color: '\x1b[38;5;109m', cwd: 'frontend', args: ['run', 'dev'] },
];

/** Resolves once something is listening on the API port, or the wait runs out. */
function waitForApi() {
  const deadline = Date.now() + API_WAIT_MS;
  return new Promise((resolve) => {
    const probe = () => {
      const socket = net
        .connect({ port: API_PORT, host: '127.0.0.1' })
        .on('connect', () => (socket.end(), resolve(true)))
        .on('error', () => {
          socket.destroy();
          if (Date.now() > deadline) return resolve(false);
          setTimeout(probe, 250);
        });
    };
    probe();
  });
}

const children = [];
let closing = false;

function start({ name, color, cwd, args }) {
  const child = spawn('npm', args, { cwd, shell: process.platform === 'win32' });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown();
  });
  children.push(child);
  return child;
}

const [api, web] = targets;
start(api);
const listening = await waitForApi();
if (!listening) {
  process.stdout.write(
    `\x1b[38;5;179m[api]\x1b[0m still not listening on ${API_PORT} after ${API_WAIT_MS / 1000}s — ` +
      'starting the web server anyway.\n'
  );
}
if (!closing) start(web);

function shutdown() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
