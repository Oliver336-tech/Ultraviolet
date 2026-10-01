import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as idb from 'fake-indexeddb';
import { MessageChannel, MessagePort, BroadcastChannel } from 'node:worker_threads';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await fs.readFile(path.join(root, 'public/scram/scramjet.all.js'), 'utf8');
const worker = await fs.readFile(process.env.PROXY_WORKER_FIXTURE || path.join(root, 'public/1k123.js'), 'utf8');
const wasm = await fs.readFile(path.join(root, 'public/scram/scramjet.wasm.wasm'));
const config = {
  prefix: '/afsd123k2/',
  files: { wasm: '/scram/scramjet.wasm.wasm', all: '/scram/scramjet.all.js', sync: '/scram/scramjet.sync.js' },
};

async function createRuntime(t, source = worker, runtimeConfig = config) {
  const factory = new idb.IDBFactory();
  const controllerMessages = [];
  const listeners = new Map();
  const ports = new Set();
  const broadcasts = [];
  const transportRequests = [];
  let windowUrl;
  let wasmFetches = 0;
  let transportFetches = 0;
  const context = {
    ...idb,
    indexedDB: factory,
    EventTarget, Event, URL, URLSearchParams, Request, Response, Headers,
    TextEncoder, TextDecoder, WebAssembly, crypto, performance, Uint8Array, ArrayBuffer,
    ReadableStream, MessagePort, WebSocket, DOMException,
    MessageChannel: class extends MessageChannel {
      constructor() {
        super();
        ports.add(this.port1);
        ports.add(this.port2);
      }
    },
    navigator: { userAgent: 'Proxy worker regression test', serviceWorker: { addEventListener() {}, controller: { postMessage: (message) => controllerMessages.push(message) } } },
    crossOriginIsolated: false,
    location: new URL('https://petezah.test/1k123.js'),
    atob, btoa, setTimeout, clearTimeout,
    console: { ...console, debug() {}, log() {} },
    BroadcastChannel: class extends BroadcastChannel {
      constructor(name) { super(name); broadcasts.push(this); }
    },
    fetch: async (url) => {
      assert.equal(new URL(String(url), context.location).pathname, config.files.wasm);
      wasmFetches++;
      return new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } });
    },
    addEventListener: (type, callback) => {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    clients: {
      claim: async () => {},
      get: async () => undefined,
      matchAll: async () => [{
        url: windowUrl,
        frameType: 'nested',
        postMessage(message) {
          const connection = new MessageChannel();
          ports.add(connection.port1);
          connection.port1.on('message', ({ message: request, port }) => {
            ports.add(port);
            if (request.type === 'ping') port.postMessage({ type: 'pong' });
            else if (request.type === 'fetch') {
              transportFetches++;
              transportRequests.push(request.fetch);
              const body = new TextEncoder().encode('<!doctype html><html><head></head><body><script>window.gameStarted = true;</script><a href="/next">Next</a></body></html>').buffer;
              port.postMessage({ type: 'fetch', fetch: {
                body, status: 200, statusText: 'OK', headers: { 'content-type': 'text/html' },
              } }, [body]);
            } else throw new Error('Unexpected transport request: ' + request.type);
            port.close();
          });
          message.port.postMessage(connection.port2, [connection.port2]);
          message.port.close();
        },
      }],
    },
    skipWaiting: async () => {},
  };
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  context.importScripts = (url) => {
    if (String(url).includes('scramjet.all.js')) vm.runInContext(bundle, context);
    else throw new Error('Unexpected import: ' + url);
  };
  vm.runInContext(bundle, context);
  const Controller = context.$scramjetLoadController().ScramjetController;
  const controller = new Controller(runtimeConfig);
  await controller.init();
  vm.runInContext(source, context);
  // Close the received end too: transferring a native MessagePort creates a
  // different object from the sender's detached reference.
  ports.add(await context.scramjet.client.worker.port);
  t.after(() => {
    for (const port of ports) port.close();
    for (const channel of broadcasts) channel.close();
  });
  async function sendConfig() {
    const jobs = [];
    const event = { data: controllerMessages.at(-1), waitUntil: (job) => jobs.push(job) };
    for (const callback of listeners.get('message') || []) callback(event);
    await Promise.all(jobs);
  }
  async function request(url, destination = 'iframe', metadata = {}) {
    const { mode, clientId = 'test-frame', ...init } = metadata;
    const req = new Request(new URL(url, context.location), init);
    Object.defineProperty(req, 'destination', { value: destination });
    if (mode) Object.defineProperty(req, 'mode', { value: mode });
    let response;
    const event = { request: req, clientId, respondWith: (job) => { response = job; } };
    for (const callback of listeners.get('fetch') || []) callback(event);
    return response ? await response : undefined;
  }
  return {
    context, sendConfig, request, transportRequests, setClientUrl: (url) => { windowUrl = url; },
    wasmFetches: () => wasmFetches, transportFetches: () => transportFetches,
  };
}

test('official controller configuration boots the actual pinned worker and rewrites HTML and JavaScript', async (t) => {
  const runtime = await createRuntime(t);
  assert.equal(runtime.context.$scramjetVersion.version, '1.1.0');
  assert.equal(runtime.context.$scramjetVersion.build, '57ba89e');
  const response = await runtime.request('/afsd123k2/' + encodeURIComponent('https://example.org/game'));
  assert.equal(response.status, 200);
  assert.equal(runtime.wasmFetches(), 1);
  const html = await response.text();
  assert.match(html, /scram\/scramjet\.wasm\.wasm/);
  const clientBootstrap = html.match(/data:application\/javascript;base64,([^"']+)/);
  assert.ok(clientBootstrap, 'the actual rewriter must inject its page bootstrap');
  assert.match(Buffer.from(clientBootstrap[1], 'base64').toString('utf8'), /\$scramjetLoadClient/);
  assert.match(html, /afsd123k2\//);
});

test('canonical WASM loader returns JavaScript for page and worker imports', async (t) => {
  const runtime = await createRuntime(t);
  for (const destination of ['script', 'worker', 'sharedworker']) {
    const response = await runtime.request(config.files.wasm, destination);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript');
    assert.match(await response.text(), /self\.WASM = '/);
  }
  assert.equal(runtime.wasmFetches(), 4, 'one initialization and three JavaScript loader responses fetch the unchanged binary');
});


test('a cold worker config message does not skip actual rewriter initialization', async (t) => {
  const runtime = await createRuntime(t);
  await runtime.sendConfig();
  const response = await runtime.request('/afsd123k2/' + encodeURIComponent('https://example.org/game'));
  assert.equal(response.status, 200);
  assert.equal(runtime.wasmFetches(), 1);
  assert.match(await response.text(), /\$scramjet/);
});

test('known advertising destinations stop before transport while publisher game files and SDKs still load', async (t) => {
  const runtime = await createRuntime(t);
  for (const host of [
    'ad.doubleclick.net', 'pagead2.googlesyndication.com', 'www.googleadservices.com',
    'aax.amazon-adsystem.com', 'ib.adnxs.com', 'ads.pubmatic.com', 'sslwidget.criteo.com',
    'static.criteo.net', 'fastlane.rubiconproject.com', 'insight.adsrvr.org', 'tlx.3lift.com',
    'fafvertizing.crazygames.com',
  ]) {
    const response = await runtime.request(config.prefix + encodeURIComponent('https://' + host + '/ad.js') + '?type=module', 'script');
    assert.equal(response.status, 204, host);
    assert.equal(await response.text(), '');
  }
  assert.equal(runtime.transportFetches(), 0, 'advertising hosts must never reach the external transport');
  for (const host of [
    'basket-random.game-files.crazygames.com', 'sdk.crazygames.com',
    'fonts.googleapis.com', 'www.gstatic.com', 'doubleclick.net.games.example',
  ]) {
    const response = await runtime.request(config.prefix + encodeURIComponent('https://' + host + '/game'));
    assert.equal(response.status, 200, host);
    assert.match(await response.text(), /\$scramjet/);
  }
  assert.equal(runtime.transportFetches(), 5);
});

test('advertising filter uses the actual configured destination codec', async (t) => {
  const runtime = await createRuntime(t, worker, {
    ...config, codec: { encode: '(value) => btoa(value)', decode: '(value) => atob(value)' },
  });
  const response = await runtime.request(config.prefix + btoa('https://ads.doubleclick.net/ad.js'), 'script');
  assert.equal(response.status, 204);
  assert.equal(runtime.transportFetches(), 0);
});

test('an isolated parent receives compatible synthetic proxy documents and WASM loader resources', async (t) => {
  const runtime = await createRuntime(t);
  // Chromium's service worker can report false while its real page is isolated.
  assert.equal(runtime.context.crossOriginIsolated, false);
  for (const [url, destination] of [
    [config.prefix + encodeURIComponent('https://games.example/play'), 'iframe'],
    [config.files.wasm, 'script'], [config.files.wasm, 'worker'], [config.files.wasm, 'sharedworker'],
  ]) {
    const response = await runtime.request(url, destination);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
    assert.match(response.headers.get('content-type'), /text\/(html|javascript)/);
    assert.ok((await response.text()).length > 0, 'decorating headers must preserve the actual rewritten content');
  }
});

test('a new iframe without clientId preserves its actual decoded parent and browser referrer policy', async (t) => {
  const runtime = await createRuntime(t);
  const parent = 'https://games.example/play?level=2#menu';
  const referrer = new URL(config.prefix + encodeURIComponent(parent), runtime.context.location).href;
  runtime.setClientUrl(referrer);
  const destination = 'https://cdn.example/game/index.html';
  const response = await runtime.request(config.prefix + encodeURIComponent(destination), 'iframe', {
    clientId: '', mode: 'navigate', referrer, referrerPolicy: 'strict-origin-when-cross-origin',
    headers: { 'x-game-fixture': 'preserved' },
  });
  assert.equal(response.status, 200);
  const upstream = runtime.transportRequests.find((request) => request.remote === destination);
  assert.ok(upstream, 'the actual pinned engine must dispatch its original Request before transport');
  assert.equal(upstream.headers.referer, 'https://games.example/');
  assert.equal(upstream.headers['sec-fetch-dest'], 'iframe');
  assert.equal(upstream.headers['sec-fetch-mode'], 'navigate');
  assert.equal(upstream.headers['x-game-fixture'], 'preserved');
  assert.equal(upstream.headers.origin, undefined, 'do not synthesize an Origin header');
  assert.equal(upstream.headers.cookie, undefined, 'do not synthesize cookies');
});

test('referrer translation respects privacy, downgrade and URL sanitization policies', async (t) => {
  const runtime = await createRuntime(t);
  const source = 'https://username:password@games.example/play?level=2#menu';
  const full = 'https://games.example/play?level=2';
  const origin = 'https://games.example/';
  for (const [policy, destination, expected] of [
    ['no-referrer', 'https://cdn.example/play', ''],
    ['same-origin', 'https://cdn.example/play', ''],
    ['strict-origin', 'http://cdn.example/play', ''],
    ['strict-origin-when-cross-origin', 'http://cdn.example/play', ''],
    ['no-referrer-when-downgrade', 'http://cdn.example/play', ''],
    ['strict-origin-when-cross-origin', 'https://games.example/next', full],
    ['origin', 'http://cdn.example/play', origin],
    ['origin-when-cross-origin', 'https://cdn.example/play', origin],
    ['unsafe-url', 'https://cdn.example/play', full],
  ]) {
    const actual = runtime.context.referrerForDestination(new URL(source), new URL(destination), policy);
    assert.equal(actual, expected, policy + ' ' + destination);
  }
});
