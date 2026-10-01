import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { JSDOM } from 'jsdom';
import { AD_FREE_SDK, createGameAssetsMiddleware } from './game-assets.mjs';

test('Tag replaces only its confirmed empty audio placeholder with a valid silent Opus WebM', async () => {
  const requests = [];
  const app = express();
  app.use('/storage/ag', createGameAssetsMiddleware({ fetchImpl: async url => {
    requests.push(url);
    return url.endsWith('/tag/media/click.webm')
      ? new Response('original-click-audio') : new Response('not found', { status: 404 });
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const path = '/storage/ag/originals/tag/media/tagged.webm';
    const full = await fetch(origin + path);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'audio/webm');
    assert.equal(full.headers.get('x-game-asset-repair'), 'silent-opus-placeholder');
    const audio = Buffer.from(await full.arrayBuffer());
    assert.equal(audio.length, 642);
    assert.equal(audio.subarray(0, 4).toString('hex'), '1a45dfa3');
    assert.ok(audio.includes(Buffer.from('OpusHead')));
    const head = await fetch(origin + path, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), String(audio.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const ranged = await fetch(origin + path, { headers: { Range: 'bytes=0-31' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 0-31/642');
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), audio.subarray(0, 32));
    const suffix = await fetch(origin + path, { headers: { Range: 'bytes=-16' } });
    assert.equal(suffix.status, 206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), audio.subarray(-16));
    const invalid = await fetch(origin + path, { headers: { Range: 'bytes=700-' } });
    assert.equal(invalid.status, 416);
    assert.equal(requests.length, 0);

    const ordinary = await fetch(origin + '/storage/ag/originals/tag/media/click.webm');
    assert.equal(await ordinary.text(), 'original-click-audio');
    assert.equal(ordinary.headers.get('x-game-asset-repair'), null);
    const missing = await fetch(origin + '/storage/ag/originals/tag/media/missing.webm');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-game-asset-repair'), null);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Tag refreshes cached empty audio while every other audio URL keeps its original path', async () => {
  const requests = [];
  const origin = 'https://games.example';
  const dom = new JSDOM('<html><body></body></html>', {
    url: origin + '/storage/ag/originals/tag/index.html', runScripts: 'dangerously',
    beforeParse(window) {
      window.Request = Request;
      window.Response = Response;
      window.fetch = input => {
        requests.push(input);
        return Promise.resolve(new Response('audio'));
      };
    },
  });
  try {
    dom.window.eval(AD_FREE_SDK);
    await dom.window.fetch('media/tagged.webm');
    assert.equal(requests[0], origin + '/storage/ag/originals/tag/media/tagged.webm?_audio=1');
    for (const input of ['media/click.webm', 'media/fon.webm', 'https://other.example/media/tagged.webm']) {
      await dom.window.fetch(input);
      assert.equal(requests.at(-1), input);
    }
  } finally { dom.window.close(); }
});
