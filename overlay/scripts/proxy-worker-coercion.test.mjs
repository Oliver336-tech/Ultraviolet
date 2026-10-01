import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'acorn';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patched = await fs.readFile(path.join(root, 'public/scram/scramjet.all.js'), 'utf8');
const original = await fs.readFile(path.join(root, 'node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js'), 'utf8');

function actualWorkerHooks(source, t) {
  const ast = parse(source, { ecmaVersion: 'latest' });
  const modules = ast.body[0].expression.callee.body.body[0].declarations[0].init.properties;
  const moduleSource = (id) => {
    const entry = modules.find((property) => property.key.value === id);
    assert.ok(entry, 'the actual pinned bundle must contain module ' + id);
    return source.slice(entry.value.start, entry.value.end);
  };
  const dom = new JSDOM('', { url: 'https://proxy.example/' });
  t.after(() => dom.window.close());
  const exports = {};
  const urlExports = {};
  const hooks = new Map();
  const context = {
    URL: dom.window.URL, location: dom.window.location,
    __exports: exports, __urlExports: urlExports,
    __require: (id) => {
      if (id === 37) return { $W: { prefix: '/afsd123k2/' }, hD: encodeURIComponent, P_: decodeURIComponent };
      if (id === 1478) return { o: () => { throw new Error('Unexpected javascript URL'); } };
      if (id === 1472) return urlExports;
      if (id === 4110) return { DD: class { async getInnerPort() { return null; } } };
      throw new Error('Unexpected module import ' + id);
    },
  };
  context.self = context;
  context.__require.r = () => {};
  context.__require.d = (target, values) => {
    for (const [name, getter] of Object.entries(values)) Object.defineProperty(target, name, { get: getter });
  };
  vm.createContext(context);
  // Execute the actual published URL rewriter and Worker constructor hooks.
  // Only the browser's native construction/transport is replaced by fixtures.
  vm.runInContext(`(${moduleSource(1472)})(null,__urlExports,__require)`, context);
  vm.runInContext(`(${moduleSource(9399)})(null,__exports,__require)`, context);
  exports.default({
    Proxy: (name, hook) => hooks.set(name, hook),
    meta: { base: new URL('https://games.example/play/index.html') },
    url: new URL('https://games.example/play/index.html'),
    natives: { call() {} },
  }, context);
  function construct(name, args) {
    let constructed;
    hooks.get(name).construct({ args, call: () => { constructed = [...args]; return { port: {} }; } });
    return constructed;
  }
  return { construct, dom };
}

test('actual Worker hook accepts a foreign-realm URL and preserves module options', (t) => {
  const url = new URL('https://games.example/play/dispatchworker.js');
  const unpatched = actualWorkerHooks(original, t);
  assert.equal(url instanceof unpatched.dom.window.URL, false);
  assert.throws(() => unpatched.construct('Worker', [url]), /startsWith/);
  const runtime = actualWorkerHooks(patched, t);
  const options = { type: 'module', name: 'game-dispatcher' };
  const [rewritten, returnedOptions] = runtime.construct('Worker', [url, options]);
  assert.equal(rewritten, 'https://proxy.example/afsd123k2/' + encodeURIComponent(url.href) + '?dest=worker&type=module');
  assert.equal(returnedOptions, options);
  assert.equal(options.name, 'game-dispatcher');
});

test('Worker and SharedWorker use string-hint coercion for custom URL inputs', (t) => {
  const runtime = actualWorkerHooks(patched, t);
  for (const name of ['Worker', 'SharedWorker']) {
    const hints = [];
    const source = { [Symbol.toPrimitive](hint) { hints.push(hint); return 'jobs.js?level=2'; } };
    const [rewritten] = runtime.construct(name, [source]);
    assert.deepEqual(hints, ['string']);
    assert.equal(rewritten, 'https://proxy.example/afsd123k2/' + encodeURIComponent('https://games.example/play/jobs.js?level=2') + '?dest=' + name.toLowerCase());
  }
});

test('standard Worker conversion errors are propagated without constructing a worker', (t) => {
  const runtime = actualWorkerHooks(patched, t);
  const cause = new Error('URL conversion failed');
  for (const name of ['Worker', 'SharedWorker']) {
    assert.throws(() => runtime.construct(name, []), /requires a script URL/);
    assert.throws(() => runtime.construct(name, [Symbol('url')]), /Symbol value/);
    assert.throws(() => runtime.construct(name, [{ toString() { throw cause; } }]), (error) => error === cause);
  }
});
