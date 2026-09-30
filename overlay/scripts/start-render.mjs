#!/usr/bin/env node
// Keep the public Node server and loopback-only Mochi proxy in one service.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mochiBinary = path.resolve(root, process.env.MOCHI_BINARY || 'backend/mochi/target/release/mochi');
const mochiWorkdir = path.join(root, '.render', 'mochi-runtime');
const children = new Set();
let stopping = false;

function stop(code = 0, signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill(signal);
  const killTimer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 10000);
  killTimer.unref();
}

function launch(name, command, args, options) {
  console.log(`[startup] Starting ${name}`);
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.add(child);
  child.once('error', (error) => {
    console.error(`[startup] ${name}: ${error.message}`);
    children.delete(child);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[startup] ${name} exited (${signal || code})`);
      stop(code || 1);
    }
  });
  return child;
}

async function main() {
  if (!existsSync(mochiBinary)) {
    throw new Error('Mochi binary is missing. Run node scripts/render-build.mjs first.');
  }
  mkdirSync(mochiWorkdir, { recursive: true });
  // Bind the public Render PORT before starting the loopback-only proxy.
  launch('web server', process.execPath, ['backend/server.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', MOCHI_MANAGED: 'true', NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=256' },
  });
  let webReady = false;
  const webDeadline = Date.now() + 90000;
  while (!stopping && Date.now() < webDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/edition`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { webReady = true; break; }
    } catch {}
    await delay(250);
  }
  if (stopping) return;
  if (!webReady) throw new Error('Public web server did not start within 90 seconds.');
  // The existing Node gateway expects Mochi on this exact internal port.
  const mochi = launch('Mochi', mochiBinary, [], {
    cwd: mochiWorkdir,
    env: {
      ...process.env,
      MOCHI_PORT: '3005',
      MOCHI_MEMORY_MB: process.env.MOCHI_MEMORY_MB || '128',
      MOCHI_CACHE_MB: process.env.MOCHI_CACHE_MB || '32',
      MOCHI_DISK_CACHE_MB: process.env.MOCHI_DISK_CACHE_MB || '256',
      MOCHI_WORKERS: process.env.MOCHI_WORKERS || '2',
    },
  });
  let healthy = false;
  const readyDeadline = Date.now() + 15000;
  while (Date.now() < readyDeadline && !stopping) {
    try {
      const response = await fetch('http://127.0.0.1:3005/health', {
        signal: AbortSignal.timeout(Math.max(1, Math.min(1000, readyDeadline - Date.now()))),
      });
      if (response.ok && (await response.text()).trim() === 'ok') {
        healthy = true;
        break;
      }
    } catch {}
    if (mochi.exitCode !== null || mochi.signalCode !== null) break;
    await delay(250);
  }
  if (!healthy) throw new Error('Mochi did not become healthy within 15 seconds.');
  if (stopping) return;
  console.log('[startup] Internal Mochi proxy is ready');
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => stop(0, signal));
}

main().catch((error) => {
  console.error('[startup]', error.message);
  stop(1);
});
