import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as idb from 'fake-indexeddb';
import { MessageChannel, MessagePort, BroadcastChannel } from 'node:worker_threads';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await fs.readFile(path.join(root, 'public/q9vx/sj.all.js'), 'utf8');
const worker = await fs.readFile(process.env.PROXY_WORKER_FIXTURE || path.join(root, 'public/1k123.js'), 'utf8');
const wasm = await fs.readFile(path.join(root, 'public/q9vx/sj.wasm.wasm'));
const config = {
  prefix: '/afsd123k2/',
  files: { wasm: '/q9vx/ld.bin', all: '/q9vx/sj.all.js', sync: '/q9vx/sj.sync.js' },
  globals: {
    wrapfn: '$voltedge$wrap', wrappropertybase: '$voltedge__', wrappropertyfn: '$voltedge$prop',
    cleanrestfn: '$voltedge$clean', importfn: '$voltedge$import', rewritefn: '$voltedge$rewrite',
    metafn: '$voltedge$meta', setrealmfn: '$voltedge$setrealm', pushsourcemapfn: '$voltedge$pushsourcemap',
    trysetfn: '$voltedge$tryset', templocid: '$voltedge$temploc', tempunusedid: '$voltedge$tempunused',
  },
  codec: { encode: '(url) => encodeURIComponent(url)', decode: '(url) => decodeURIComponent(url)' },
  flags: {
    serviceworkers: false, syncxhr: false, strictRewrites: true, rewriterLogs: false,
    captureErrors: true, cleanErrors: false, scramitize: false, sourcemaps: false,
    destructureRewrites: false, interceptDownloads: false, allowInvalidJs: false,
    allowFailedIntercepts: true,
  },
  siteFlags: {},
};

async function createRuntime(t, source = worker) {
  const factory = new idb.IDBFactory();
  const db = await new Promise((resolve, reject) => {
    const request = factory.open('$voltedge', 1);
    request.onupgradeneeded = () => {
      for (const store of ['config', 'cookies', 'redirectTrackers', 'referrerPolicies', 'publicSuffixList']) {
        request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('config', 'readwrite');
    transaction.objectStore('config').put(config, 'config');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  const listeners = new Map();
  const ports = new Set();
  const broadcasts = [];
  let wasmFetches = 0;
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
    navigator: { userAgent: 'Proxy worker regression test', serviceWorker: {} },
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
        postMessage(message) {
          const connection = new MessageChannel();
          ports.add(connection.port1);
          connection.port1.on('message', ({ message: request, port }) => {
            ports.add(port);
            if (request.type === 'ping') port.postMessage({ type: 'pong' });
            else if (request.type === 'fetch') {
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
    if (String(url).includes('sj.all.js')) vm.runInContext(bundle, context);
    else throw new Error('Optional Rivet router is outside this engine regression');
  };
  vm.runInContext(source, context);
  // Close the received end too: transferring a native MessagePort creates a
  // different object from the sender's detached reference.
  ports.add(await context._engine.client.worker.port);
  t.after(() => {
    for (const port of ports) port.close();
    for (const channel of broadcasts) channel.close();
  });
  async function sendConfig() {
    const jobs = [];
    const event = { data: { 'voltedge$type': 'loadConfig', config }, waitUntil: (job) => jobs.push(job) };
    for (const callback of listeners.get('message') || []) callback(event);
    await Promise.all(jobs);
  }
  async function request(url, destination = 'iframe') {
    const req = new Request(new URL(url, context.location));
    Object.defineProperty(req, 'destination', { value: destination });
    let response;
    const event = { request: req, clientId: 'test-frame', respondWith: (job) => { response = job; } };
    for (const callback of listeners.get('fetch') || []) callback(event);
    return response ? await response : undefined;
  }
  return { context, sendConfig, request, wasmFetches: () => wasmFetches };
}

test('actual bundled worker hydrates core config and WASM after a controller config message', async (t) => {
  const runtime = await createRuntime(t);
  assert.equal(typeof runtime.context.$voltedgeLoadWorker().VoltedgeServiceWorker.prototype.setConfig, 'undefined');
  await runtime.sendConfig();
  assert.equal(runtime.wasmFetches(), 1, 'hydration must initialize the actual rewriter, not merely cache a config object');
  const response = await runtime.request('/afsd123k2/' + encodeURIComponent('https://example.org/game'));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /q9vx\/ld\.bin/);
  const clientBootstrap = html.match(/data:application\/javascript;base64,([^"']+)/);
  assert.ok(clientBootstrap, 'the actual rewriter must inject its page bootstrap');
  assert.match(Buffer.from(clientBootstrap[1], 'base64').toString('utf8'), /\$voltedgeLoadClient/);
  assert.match(html, /afsd123k2\//);
});

test('injected WASM page and module-worker imports receive JavaScript while binary fetches bypass', async (t) => {
  const runtime = await createRuntime(t);
  await runtime.sendConfig();
  for (const destination of ['script', 'worker', 'sharedworker']) {
    const response = await runtime.request(config.files.wasm, destination);
    assert.ok(response, destination + ' bootstrap must be routed through the engine');
    assert.equal(response.headers.get('content-type'), 'text/javascript');
    const script = await response.text();
    assert.match(script, /self\.WASM = '/);
  }
  assert.equal(await runtime.request(config.files.wasm, ''), undefined);
});
