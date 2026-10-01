import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { clearChallengeRequired, isDatacenterIp, isUnusualBrowser, markChallengeRequired, needsCaptchaChallenge } from '../backend/middleware/challenge-risk.js';
import { systemState, updateIPReputation } from '../backend/middleware/security.js';
import { isAllowedWebsocketOrigin } from '../backend/middleware/http-security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/131.0.0.0 Safari/537.36';
const request = ip => ({ socket: { remoteAddress: ip }, headers: { 'user-agent': browserUa, accept: '*/*' } });

test('the public clone does not require CAPTCHA for network location or browser automation alone', () => {
  assert.equal(isDatacenterIp('45.55.10.10'), true);
  assert.equal(isUnusualBrowser(request('45.55.10.10')), true);
  assert.equal(needsCaptchaChallenge(request('45.55.10.10')), false);
});

test('host pressure alone does not classify ordinary public browsing as abuse', () => {
  const previous = { state: systemState.state, cpuHigh: systemState.cpuHigh };
  try {
    systemState.state = 'BUSY';
    systemState.cpuHigh = true;
    assert.equal(needsCaptchaChallenge(request('198.51.100.73')), false);
    assert.equal(needsCaptchaChallenge(request('45.55.10.10')), false);
  } finally {
    systemState.state = previous.state;
    systemState.cpuHigh = previous.cpuHigh;
  }
});

test('observed abuse still triggers challenges', () => {
  const ip = '198.51.100.37';
  markChallengeRequired(ip);
  assert.equal(needsCaptchaChallenge(request(ip)), true);
  clearChallengeRequired(ip);
  assert.equal(needsCaptchaChallenge(request(ip)), false);
  updateIPReputation(ip, -12);
  assert.equal(needsCaptchaChallenge(request(ip)), true);
  updateIPReputation(ip, 12);
  const previous = systemState.state;
  try {
    systemState.state = 'ATTACK';
    assert.equal(needsCaptchaChallenge(request(ip)), true);
  } finally { systemState.state = previous; }
});

test('Wisp accepts only the configured website origin', () => {
  const previous = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = 'https://games.example';
  try {
    const req = origin => ({ headers: { origin, host: 'games.example' } });
    assert.equal(isAllowedWebsocketOrigin(req('https://games.example')), true);
    for (const origin of [undefined, 'null', 'https://games.example.evil.test', 'http://games.example', 'https://games.example/path']) {
      assert.equal(isAllowedWebsocketOrigin(req(origin)), false, String(origin));
    }
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = previous;
  }
});

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('actual production backend serves public browsing while account/admin and relay protections remain active', { timeout: 45000 }, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'petezah-public-entry-'));
  let child;
  let logs = '';
  const sockets = [];
  try {
    // Copy source into an isolated checkout: initialization must not touch the
    // developer's database or load deployment environment files.
    await cp(path.join(root, 'backend'), path.join(workspace, 'backend'), {
      recursive: true, filter: file => !path.basename(file).startsWith('.env') && !file.includes(`${path.sep}mochi${path.sep}`) && path.basename(file) !== 'mochi',
    });
    await symlink(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
    await symlink(path.join(root, 'scripts'), path.join(workspace, 'scripts'), 'dir');
    await symlink(path.join(root, 'public'), path.join(workspace, 'public'), 'dir');
    await writeFile(path.join(workspace, 'package.json'), '{"type":"module"}');
    await mkdir(path.join(workspace, 'dist/storage/data'), { recursive: true });
    await mkdir(path.join(workspace, 'dist/static'), { recursive: true });
    await writeFile(path.join(workspace, 'dist/index.html'), '<!doctype html><title>Public game browser</title><main>PUBLIC_ENTRY_READY</main>');
    await cp(path.join(root, 'public/storage/data/collection.json'), path.join(workspace, 'dist/storage/data/collection.json'));
    for (const file of ['iframe.html', 'embed.html', 'static/google-embed.html', 'static/libcurl-embed.html', 'static/scram-embed.html', 'runtime-viewer.js']) {
      await cp(path.join(root, 'public', file), path.join(workspace, 'dist', file));
    }
    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['backend/server.js'], {
      cwd: workspace,
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', RENDER: '', MOCHI_MANAGED: '', BOT_TOKEN: '',
        TOKEN_SECRET: 'test-only-public-entry-token-secret', SESSION_SECRET: 'test-only-public-entry-session-secret',
        CAP_SECRET: 'test-only-public-entry-cap-secret', ADMIN_EMAIL: 'owner@example.test', PUBLIC_ORIGIN: origin, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { logs += data; });
    child.stderr.on('data', data => { logs += data; });
    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Backend exited: ${logs}`);
      try {
        const res = await fetch(origin + '/healthz', { signal: AbortSignal.timeout(500) });
        if (res.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, logs);
    const get = url => fetch(origin + url, { redirect: 'manual', headers: { 'user-agent': browserUa }, signal: AbortSignal.timeout(3000) });
    const home = await get('/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /PUBLIC_ENTRY_READY/);
    assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(home.headers.get('cross-origin-embedder-policy'), 'require-corp');
    const catalogue = await get('/storage/data/collection.json');
    assert.equal(catalogue.status, 200);
    assert.ok((await catalogue.json()).games.length > 0);
    for (const url of ['/api/games/catalog', '/api/games/plays']) {
      const response = await get(url);
      assert.equal(response.status, 200, url);
      await response.json();
    }
    for (const [url, mime] of [['/scram/scramjet.all.js', /javascript/], ['/scram/scramjet.wasm.wasm', /wasm/], ['/baremux/worker.js', /javascript/], ['/libcurl/index.mjs', /javascript/]]) {
      const response = await get(url);
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-type'), mime, url);
      await response.arrayBuffer();
    }
    const runtime = await get('/scram/scramjet.all.js');
    assert.match(await runtime.text(), /__moduleIdentityFixed/, 'Serves the generated module-identity compatibility hook');
    for (const url of ['/iframe.html', '/embed.html', '/static/google-embed.html', '/static/libcurl-embed.html', '/static/scram-embed.html']) {
      const response = await get(url);
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-type'), /text\/html/, url);
      assert.match(await response.text(), /\/runtime-viewer\.js/, url);
    }
    const viewer = await get('/runtime-viewer.js');
    assert.equal(viewer.status, 200);
    assert.match(viewer.headers.get('content-type'), /javascript/);
    assert.match(await viewer.text(), /register\('\/1k123\.js(?:\?[^']*)?'/);
    for (const url of ['/api/me', '/api/admin/users', '/api/admin/games/excluded']) {
      const response = await get(url);
      assert.equal(response.status, 401, url);
      assert.match((await response.json()).error, /unauthor|authentication|sign in/i);
    }
    const signup = await fetch(origin + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': browserUa }, body: '{}' });
    assert.equal(signup.status, 400);
    assert.match((await signup.json()).error, /agree.*Terms/i);

    const connect = route => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
      sockets.push(ws);
      return ws;
    };
    const ws = connect('/api/websocket/');
    const closedPrivateStream = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Wisp private-IP rejection timed out')), 3000);
      ws.on('message', data => {
        const packet = Buffer.from(data);
        if (packet[0] === 4 && packet.readUInt32LE(1) === 1) { clearTimeout(timer); resolve(packet[5]); }
      });
      ws.on('error', reject);
    });
    await once(ws, 'open');
    const host = Buffer.from('127.0.0.1');
    const packet = Buffer.alloc(8 + host.length);
    packet[0] = 1; packet.writeUInt32LE(1, 1); packet[5] = 1; packet.writeUInt16LE(80, 6); host.copy(packet, 8);
    ws.send(packet);
    assert.equal(await closedPrivateStream, 0x48, 'Loopback destination remains blocked');
    ws.close();
    const alias = connect('/wisp/');
    await once(alias, 'open');
    alias.close();
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/api/websocket/`, { origin: 'https://foreign.example' });
    sockets.push(rejected);
    await new Promise((resolve, reject) => {
      rejected.on('open', () => reject(new Error('Foreign origin was accepted')));
      rejected.on('error', resolve);
      rejected.on('unexpected-response', () => resolve());
    });
    const app = await readFile(path.join(root, 'src/App.tsx'), 'utf8');
    assert.doesNotMatch(app, /LegalReagreeModal|SvgAccessGate/);
    assert.match(app, /ActivityCaptchaModal/);
  } finally {
    for (const ws of sockets) ws.terminate();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await rm(workspace, { recursive: true, force: true });
  }
});
