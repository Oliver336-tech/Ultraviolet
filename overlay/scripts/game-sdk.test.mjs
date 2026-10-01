import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { AD_FREE_SDK, GAME_SDK_URL, GAME_ASSET_SOURCES, gameAssetContentType, resolveGameAsset } from './game-assets.mjs';

test('Ragdoll Hit starts its Unity loader when the external advertising SDK is unavailable', async () => {
  const bootstrap = await readFile(new URL('./fixtures/ragdoll-hit-master-loader.js', import.meta.url), 'utf8');
  const requests = [];
  let resolveEngine;
  const engineStarted = new Promise(resolve => { resolveEngine = resolve; });
  class GameResources extends ResourceLoader {
    fetch(url) {
      requests.push(url);
      const parsed = new URL(url);
      if (parsed.origin !== 'https://games.example') return Promise.reject(new Error('Advertising SDK unavailable'));
      if (parsed.pathname === '/storage/ag/sdk/ad-free.js') return Promise.resolve(Buffer.from(AD_FREE_SDK));
      if (parsed.pathname.endsWith('/master-loader.js')) return Promise.resolve(Buffer.from(bootstrap));
      if (parsed.pathname.endsWith('/unity-2020.js')) {
        // The real bootstrap must reach its engine script and finish SDK init.
        // Graphics/build downloads are outside this bootstrap regression test.
        return Promise.resolve(Buffer.from('PokiSDK.init().then(() => window.engineStarted());'));
      }
      return Promise.reject(new Error(`Unexpected script: ${url}`));
    }
  }
  const dom = new JSDOM('<html><head><script src="/storage/ag/sdk/ad-free.js"></script>'
    + '<script>window.config={loader:"unity-2020",unityVersion:"2022.3.36f1"};</script></head>'
    + '<body><script src="master-loader.js"></script></body></html>', {
    url: 'https://games.example/storage/ag/originals/ragdoll-hit/index.html',
    runScripts: 'dangerously', resources: new GameResources(), virtualConsole: new VirtualConsole(),
    beforeParse(window) { window.engineStarted = resolveEngine; },
  });
  let timeout;
  try {
    await Promise.race([engineStarted, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Game bootstrap is stuck waiting for the SDK load callback')), 1500);
    })]);
    assert.equal(requests.filter(url => new URL(url).pathname === '/storage/ag/sdk/ad-free.js').length, 2);
    assert.ok(requests.some(url => url.endsWith('/ragdoll-hit/unity-2020.js')));
    assert.ok(requests.every(url => new URL(url).origin === 'https://games.example'));
  } finally { clearTimeout(timeout); dom.window.close(); }
});

test('dynamic SDK scripts preserve browser load callbacks, language and invite-link promises', async () => {
  const loaded = [];
  class SdkResources extends ResourceLoader {
    fetch(url) {
      loaded.push(url);
      assert.equal(new URL(url).pathname, '/storage/ag/sdk/ad-free.js');
      return Promise.resolve(Buffer.from(AD_FREE_SDK));
    }
  }
  const dom = new JSDOM('<html><head></head><body></body></html>', {
    url: 'https://games.example/storage/ag/originals/test/index.html',
    runScripts: 'dangerously', resources: new SdkResources(),
  });
  try {
    dom.window.eval(AD_FREE_SDK);
    for (const [url, insert] of [
      ['https://sdk.poki.com/v2/poki-sdk.js', 'property'],
      ['https://sdk.crazygames.com/crazygames-sdk-v3.js', 'attribute'],
      ['https://game-cdn.poki.com/scripts/revision/poki-sdk-core-revision.js', 'append'],
    ]) {
      const script = dom.window.document.createElement('script');
      const loadedScript = new Promise(resolve => { script.onload = resolve; });
      if (insert === 'attribute') script.setAttribute('src', url);
      else script.src = url;
      script.integrity = 'sha256-old-advertising-sdk';
      if (insert === 'append') dom.window.document.head.append(script);
      else dom.window.document.head.appendChild(script);
      await loadedScript;
      assert.equal(script.getAttribute('src'), GAME_SDK_URL);
      // Integrity for the original advertising script must not reject the shim.
      assert.equal(script.getAttribute('integrity'), null);
    }
    assert.equal(loaded.length, 3);
    assert.equal(dom.window.PokiSDK.getLanguage(), 'en');
    assert.equal(await dom.window.PokiSDK.shareableURL(), dom.window.location.href);
    await dom.window.PokiSDK.init();
  } finally { dom.window.close(); }
});

test('the SDK redirect preserves ordinary game scripts and unrelated script attributes', () => {
  const dom = new JSDOM('<html><head></head><body></body></html>', {
    url: 'https://games.example/storage/ag/originals/test/index.html', runScripts: 'dangerously',
  });
  try {
    dom.window.eval(AD_FREE_SDK);
    for (const url of ['scripts/main.js', 'https://assets.example/main.bundle.js', 'Build/game.loader.js']) {
      const script = dom.window.document.createElement('script');
      script.src = url;
      script.setAttribute('integrity', 'sha256-game-build');
      dom.window.document.head.appendChild(script);
      assert.equal(script.getAttribute('src'), url);
      assert.equal(script.getAttribute('integrity'), 'sha256-game-build');
    }
    const image = dom.window.document.createElement('img');
    image.setAttribute('src', 'poki-sdk.js');
    assert.equal(image.getAttribute('src'), 'poki-sdk.js');
  } finally { dom.window.close(); }
});

test('Ragdoll Hit build requests from its cached CDN loader use the complete pinned same-origin library', async () => {
  const origin = 'https://games.example';
  const cdn = 'https://cdn.jsdelivr.net/gh/Collasperz/ragdoll-hit/Build/';
  const requests = [];
  let xhrRequest;
  const dom = new JSDOM('<html><head></head><body></body></html>', {
    url: origin + '/storage/ag/originals/ragdoll-hit/index.html', runScripts: 'dangerously',
    beforeParse(window) {
      window.Request = Request;
      window.Response = Response;
      window.fetch = (input, init) => {
        requests.push({ input, init });
        return Promise.resolve(new Response('build-bytes'));
      };
      window.XMLHttpRequest.prototype.open = (...args) => { xhrRequest = args; };
    },
  });
  try {
    dom.window.eval(AD_FREE_SDK);
    const loader = dom.window.document.createElement('script');
    loader.src = cdn + 'd9d605cb1c18b4ed9fb179406f02ceab.loader.js';
    dom.window.document.head.appendChild(loader);
    assert.equal(loader.src, origin + '/storage/ag/arsenic/ragdoll-hit/Build/d9d605cb1c18b4ed9fb179406f02ceab.loader.js');
    const data = '3338c1fab0254118d94e7278963be9f4.data.unityweb';
    const request = new Request(cdn + data, { headers: { Range: 'bytes=0-31' } });
    await dom.window.fetch(request);
    assert.equal(requests[0].input.url, origin + '/storage/ag/arsenic/ragdoll-hit/Build/' + data);
    assert.equal(requests[0].input.headers.get('range'), 'bytes=0-31');
    const wasm = '1aedb70085073113e2b55ca86f37e2e8.wasm.unityweb';
    new dom.window.XMLHttpRequest().open('GET', cdn + wasm, true);
    assert.deepEqual(xhrRequest, ['GET', origin + '/storage/ag/arsenic/ragdoll-hit/Build/' + wasm, true]);
    for (const file of [data, wasm, 'ae7e3b4bdec4176bd62c24dfc2799d25.framework.js.unityweb']) {
      assert.deepEqual(resolveGameAsset('/originals/ragdoll-hit/Build/' + file), { source: 'hit', file: 'Build/' + file });
    }
    assert.equal(GAME_ASSET_SOURCES.hit.revision, 'a2c2be028d5d4f97ad30cff9b3fc656b26bf85b9');
    assert.equal(GAME_ASSET_SOURCES.hit.origins.length, 1);
    assert.ok(GAME_ASSET_SOURCES.hit.origins[0].includes('/' + GAME_ASSET_SOURCES.hit.revision + '/'));
    assert.equal(gameAssetContentType('Build/ae7e3b4bdec4176bd62c24dfc2799d25.framework.js.unityweb'), 'application/javascript; charset=utf-8');
    assert.equal(gameAssetContentType('Build/' + wasm), 'application/wasm');
    for (const url of ['https://cdn.jsdelivr.net.evil.example/gh/Collasperz/ragdoll-hit/Build/game.wasm',
      'https://cdn.jsdelivr.net/gh/OtherAuthor/ragdoll-hit/Build/game.wasm', 'https://assets.example/game.wasm']) {
      await dom.window.fetch(url);
      assert.equal(requests.at(-1).input, url);
    }
  } finally { dom.window.close(); }
});
