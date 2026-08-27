#!/usr/bin/env node
/**
 * Runs the API and the Vite dev server together, with no extra dependencies.
 * Usage: npm run dev
 */
import { spawn } from 'node:child_process';

const targets = [
  { name: 'api', color: '\x1b[38;5;179m', cwd: 'backend', args: ['run', 'dev'] },
  { name: 'web', color: '\x1b[38;5;109m', cwd: 'frontend', args: ['run', 'dev'] },
];

const children = targets.map(({ name, color, cwd, args }) => {
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
  return child;
});

let closing = false;
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
