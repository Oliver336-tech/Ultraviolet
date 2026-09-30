import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { JSDOM } from 'jsdom';
import { createSecurityHeaders } from '../backend/middleware/http-security.js';
import {
  GAME_ASSET_SOURCES, createGameAssetsMiddleware, resolveGameAsset, sanitizeGameHtml,
} from './game-assets.mjs';

// The base and resource names come from the pinned Games-lib HTML entrypoints.
const fixtures = [
  { game: 'arsenic/drive-mad', file: 'drive-mad/index.html',
    base: 'https://cdn.jsdelivr.net/gh/genizy/dmad-poki@49b5ab6b987f5f3be58f9dae59c92e8fc1aab9b0/',
    localBase: '/storage/ag/arsenic/drive-mad/',
    script: 'webapp/index.js', data: 'webapp/index.wasm', source: 'petezah',
    upstreamScript: 'drive-mad/webapp/index.js', upstreamData: 'drive-mad/webapp/index.wasm' },
  { game: 'originals/superstarcar', file: 'superstarcar/index.html',
    base: 'https://cdn.jsdelivr.net/gh/genizy/cg-rip@main/super-star-car/',
    localBase: '/storage/ag/cg/super-star-car/',
    script: 'Build/Super star car v1.21.loader.js', data: 'Build/Super star car v1.21.data.part1', source: 'cg',
    upstreamScript: 'super-star-car/Build/Super star car v1.21.loader.js',
    upstreamData: 'super-star-car/Build/Super star car v1.21.data.part1' },
  { game: 'arsenic/sky-riders', file: 'sky-riders/index.html',
    base: 'https://cdn.jsdelivr.net/gh/genizy/cg-rip@main/sky-riders/',
    localBase: '/storage/ag/cg/sky-riders/',
    script: 'Build/a9ca25dad32ea4465298c2a33b5cc5e4.loader.js', data: 'Build/b6a88957bd0da804399c52d3f24e4c48.wasm.part1', source: 'cg',
    upstreamScript: 'sky-riders/Build/a9ca25dad32ea4465298c2a33b5cc5e4.loader.js',
    upstreamData: 'sky-riders/Build/b6a88957bd0da804399c52d3f24e4c48.wasm.part1' },
];

for (const f of fixtures) {
  test(`${f.game}: relative loader and binary requests use an allowed pinned same-origin base`, async () => {
    const origin = 'https://games.example';
    const input = `<html><head><base href="${f.base}"></head><body><script src="${f.script}"></script></body></html>`;
    const html = sanitizeGameHtml(input, { source: 'petezah', file: f.file });
    const document = new JSDOM(html, { url: `${origin}/storage/ag/${f.game}/index.html` }).window.document;
    assert.equal(document.baseURI, origin + f.localBase);
    const gameScript = document.querySelector('body script').src;
    const gameData = new URL(f.data, document.baseURI).href;
    for (const [url, file] of [[gameScript, f.upstreamScript], [gameData, f.upstreamData]]) {
      assert.equal(new URL(url).origin, origin);
      assert.deepEqual(resolveGameAsset(new URL(url).pathname), { source: f.source, file });
    }

    const calls = [];
    const app = express();
    app.use(createSecurityHeaders());
    app.use('/storage/ag', createGameAssetsMiddleware({ fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('abcd', { status: options.headers.Range ? 206 : 200,
        headers: options.headers.Range ? { 'content-range': 'bytes 0-3/100', 'accept-ranges': 'bytes' } : {} });
    } }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    try {
      const loader = await fetch(local + new URL(gameScript).pathname);
      assert.equal(loader.status, 200);
      assert.match(loader.headers.get('content-type'), /^application\/javascript/);
      assert.match(loader.headers.get('content-security-policy'), /(?:^|; )base-uri 'self'(?:;|$)/);
      await loader.text();
      const binary = await fetch(local + new URL(gameData).pathname, { headers: { Range: 'bytes=0-3' } });
      assert.equal(binary.status, 206);
      assert.equal(binary.headers.get('content-range'), 'bytes 0-3/100');
      assert.equal(await binary.text(), 'abcd');
      for (let i = 0; i < calls.length; i++) {
        const prefix = GAME_ASSET_SOURCES[f.source].origins[0];
        assert.ok(calls[i].url.startsWith(prefix), calls[i].url);
        const expectedFile = i === 0 ? f.upstreamScript : f.upstreamData;
        assert.equal(calls[i].url.slice(prefix.length), expectedFile.split('/').map(encodeURIComponent).join('/'));
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('unrelated external base tags cannot become arbitrary asset proxy destinations', () => {
  for (const href of ['https://cdn.jsdelivr.net/gh/stranger/repo@main/', 'https://example.net/',
    'https://cdn.jsdelivr.net.evil.example/gh/genizy/cg-rip@main/', 'http://cdn.jsdelivr.net/gh/genizy/cg-rip@main/']) {
    assert.match(sanitizeGameHtml(`<base href="${href}">`), new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(resolveGameAsset('/cg/%2e%2e/server.js'), null);
  assert.equal(GAME_ASSET_SOURCES.cg.origins.length, 1);
  assert.ok(GAME_ASSET_SOURCES.cg.origins[0].endsWith('/151f9126d2ccb6b81dc0f93155e305900d423d5c/'));
});

test('all other external bases in the pinned GameLib entrypoints have a same-origin asset source', () => {
  const known = [
    ['bowmasters', 'https://rawcdn.githack.com/bubbls/youtube-playables/main/bowmasters/', 'arsenic/bowmasters/'],
    ['tiny-fishing', '//m.coolmathgames.com/sites/default/files/public_games/33145/', 'arsenic/tiny-fishing/'],
    ['buckshot-roullete', 'https://cdn.jsdelivr.net/gh/genizy/web-port@main/buckshot-roulette/index.html', 'ports/buckshot-roulette/index.html'],
    ['ultrakill', 'https://cdn.jsdelivr.net/gh/genizy/web-port@main/ultrakill/', 'ports/ultrakill/'],
    ['clash-royale', 'https://cdn.jsdelivr.net/gh/bubbls/UGS-Assets@main/clashofvikings/', 'ugs/clashofvikings/'],
    ['crushed-adventures', 'https://cdn.jsdelivr.net/gh/the2amgamer/crushed-advendutrs/', 'crushed/'],
    ['buildnowgg', 'https://cdn.jsdelivr.net/gh/genizy/cg-rip@main/buildnow-gg/', 'cg/buildnow-gg/'],
    ['fc-25', 'https://cdn.jsdelivr.net/gh/genizy/cg-rip@main/cg-fc-24/', 'cg/cg-fc-24/'],
    ['highway-racer', 'https://cdn.jsdelivr.net/gh/genizy/cg-rip@main/highway-racer/', 'cg/highway-racer/'],
    ['spacewaves', 'https://cdn.jsdelivr.net/gh/genizy/cg-rip@main/space-waves/', 'cg/space-waves/'],
  ];
  for (const [game, base, expected] of known) {
    const html = sanitizeGameHtml(`<html><head><base href="${base}"></head></html>`,
      { source: 'petezah', file: `${game}/index.html` });
    const document = new JSDOM(html, { url: `https://games.example/storage/ag/arsenic/${game}/index.html` }).window.document;
    assert.equal(document.baseURI, `https://games.example/storage/ag/${expected}`, game);
    const resource = new URL('Build/main.js', document.baseURI);
    assert.equal(resource.origin, 'https://games.example', game);
    assert.ok(resolveGameAsset(resource.pathname), game);
  }
});

test('Ultrakill uses its pinned port wrapper rather than an unavailable build hash', () => {
  assert.deepEqual(resolveGameAsset('/originals/ultrakill/index.html'), { source: 'ports', file: 'ultrakill/index.html' });
  assert.deepEqual(resolveGameAsset('/arsenic/ultrakill/index.html'), { source: 'ports', file: 'ultrakill/index.html' });
  const html = sanitizeGameHtml('<html><head><base href="https://cdn.jsdelivr.net/gh/genizy/web-port@latest/ultrakill/"></head>'
    + '<body><script src="Build/ultrakill.loader.js"></script></body></html>', { source: 'ports', file: 'ultrakill/index.html' });
  const document = new JSDOM(html, { url: 'https://games.example/storage/ag/originals/ultrakill/index.html' }).window.document;
  assert.equal(document.querySelector('body script').src, 'https://games.example/storage/ag/ports/ultrakill/Build/ultrakill.loader.js');
});
