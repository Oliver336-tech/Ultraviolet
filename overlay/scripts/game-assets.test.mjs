import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import {
  resolveGameAsset, gameAssetContentType, sanitizeGameHtml, createGameAssetsMiddleware,
} from './game-assets.mjs';

test('catalog game URLs map to library files, including renamed entrypoints', async () => {
  const { games } = JSON.parse(await readFile(new URL('../public/storage/data/collection.json', import.meta.url)));
  const local = games.map(game => new URL(game.url, 'https://example.test').searchParams.get('url'))
    .filter(url => url?.startsWith('/storage/ag/'));
  assert.equal(local.length, 445);
  for (const url of local) {
    if (url === '/storage/ag/apps/geforce/index.html') continue;
    assert.ok(resolveGameAsset(url), `Missing mapping: ${url}`);
  }
  assert.deepEqual(resolveGameAsset('/echo/chess/index.html'), { source: 'echo', file: 'chess/chess.html' });
  assert.deepEqual(resolveGameAsset('/echo/fantasy-dash/index.html'), { source: 'echo', file: 'fantasy-dash/Fantasy Dash.html' });
  assert.deepEqual(resolveGameAsset('/originals/precision/index.html'), { source: 'precision', file: 'web/index.html' });
  assert.deepEqual(resolveGameAsset('/originals/redball/index.html'), { source: 'petezah', file: 'redball/1.html' });
  assert.deepEqual(resolveGameAsset('/echo/mcje/index.html'), { source: 'precision', file: 'web/index.html' });
  assert.deepEqual(resolveGameAsset('/echo/mcje/classes.js'), { source: 'precision', file: 'web/classes.js' });
});

test('asset path traversal cannot reach another source or local file', () => {
  for (const value of ['/echo/../server.js', '/echo/%2e%2e/server.js', '/echo/a/./x', '/echo/%5cserver', '/echo/%00x', '/echo/%xx']) {
    assert.equal(resolveGameAsset(value), null, value);
  }
  assert.equal(resolveGameAsset('/unknown/game/index.html'), null);
});

test('MIME types support HTML, JS modules, WASM and precompressed Unity files', () => {
  assert.equal(gameAssetContentType('game/index.html'), 'text/html; charset=utf-8');
  assert.equal(gameAssetContentType('game/scripts/main.mjs'), 'application/javascript; charset=utf-8');
  assert.equal(gameAssetContentType('game/Build/game.wasm.gz'), 'application/wasm');
  assert.equal(gameAssetContentType('game/Build/game.data'), 'application/octet-stream');
});

test('ad removal preserves game code and original notices', () => {
  const input = '<!-- Copyright the game author --><script src="https://www.googletagmanager.com/gtag/js?id=123"></script>' +
    '<script>window.dataLayer=[]; gtag("config", "123");</script><script src="poki-sdk.js"></script>' +
    '<script src="scripts/main.js" type="module"></script><script>window.gameStart=true;</script>';
  const output = sanitizeGameHtml(input);
  assert.match(output, /Copyright the game author/);
  assert.doesNotMatch(output, /googletagmanager|dataLayer|gtag\(/);
  assert.match(output, /\/storage\/ag\/sdk\/ad-free\.js/);
  assert.match(output, /scripts\/main\.js/);
  assert.match(output, /window\.gameStart=true/);
});

test('middleware streams range requests and caches sanitized HTML with correct MIME', async () => {
  const calls = [];
  const app = express();
  app.use('/storage/ag', createGameAssetsMiddleware({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('main.js')) return new Response('xyz', { status: 206, headers: { 'content-range': 'bytes 1-3/10', 'accept-ranges': 'bytes' } });
    return new Response('<script src="/js/main.js"></script><h1>Play</h1>', { headers: { 'content-type': 'text/plain' } });
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(base + '/storage/ag/arsenic/tag/index.html');
    assert.match(first.headers.get('content-type'), /^text\/html/);
    const firstBody = await first.text();
    assert.match(firstBody, /<h1>Play<\/h1>/);
    assert.doesNotMatch(firstBody, /src="\/js\/main\.js"/);
    const second = await fetch(base + '/storage/ag/arsenic/tag/index.html');
    assert.equal(await second.text(), firstBody);
    assert.equal(calls.length, 1);
    const ranged = await fetch(base + '/storage/ag/arsenic/tag/scripts/main.js', { headers: { Range: 'bytes=1-3' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 1-3/10');
    assert.match(ranged.headers.get('content-type'), /^application\/javascript/);
    assert.equal(await ranged.text(), 'xyz');
    assert.equal(calls[1].options.headers.Range, 'bytes=1-3');
    assert.match(calls[0].url, /1534c55d4771fa93742120c8c0ef29d2ee48f089\/tag\/index\.html$/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('ranged WASM requests serve original bytes rather than a partial compressed representation', async () => {
  const wasm = Buffer.from('0061736d01000000', 'hex');
  const app = express();
  app.use('/storage/ag', createGameAssetsMiddleware({ fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-7');
    // Model a CDN that returns a Brotli representation when compression is
    // negotiated. Such a prefix cannot be decoded into the requested bytes.
    const identity = options.headers['Accept-Encoding'] === 'identity';
    return new Response(identity ? wasm : Buffer.from('9bf27723ffa7600c', 'hex'), {
      status: 206,
      headers: { 'content-range': identity ? 'bytes 0-7/2324467' : 'bytes 0-7/1007268', 'accept-ranges': 'bytes' },
    });
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/storage/ag/arsenic/drive-mad/webapp/index.wasm`,
      { headers: { Range: 'bytes=0-7' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-7/2324467');
    assert.match(response.headers.get('content-type'), /^application\/wasm/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wasm);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
