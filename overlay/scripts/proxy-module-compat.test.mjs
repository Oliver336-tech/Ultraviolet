import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = await fs.readFile(path.join(root, 'scripts/proxy-module-compat.js'), 'utf8');
const prefix = '/afsd123k2/';
const encoded = prefix + encodeURIComponent('https://games.example/assets/entry.js?level=1');

function dom() {
  const dom = new JSDOM('<!doctype html><base href="https://proxy.example/afsd123k2/">', {
    url: 'https://proxy.example/browser', runScripts: 'outside-only',
  });
  const window = dom.window;
  const originalGet = window.Element.prototype.getAttribute;
  const originalSet = window.Element.prototype.setAttribute;
  window[window.Symbol.for('scramjet client global')] = { natives: { store: {
    'Element.prototype.getAttribute': originalGet,
    'Element.prototype.setAttribute': originalSet,
  } }, descriptors: { store: { 'Node.prototype.baseURI': Object.getOwnPropertyDescriptor(window.Node.prototype, 'baseURI') } } };
  window.$scramjetLoadClient = () => ({ loadAndHook() {} });
  window.eval(hook);
  window.$scramjetLoadClient().loadAndHook({ prefix });
  return { dom, window, document: window.document, originalGet, originalSet };
}

function assertModule(runtime, script) {
  const source = new URL(runtime.originalGet.call(script, 'src'), runtime.document.URL);
  assert.equal(source.pathname, encoded);
  assert.equal(source.search, '?type=module');
  assert.equal(decodeURIComponent(source.pathname.slice(prefix.length)), 'https://games.example/assets/entry.js?level=1');
}

test('dynamic module entrypoints keep one URL for property and attribute assignment in either order', () => {
  for (const attributes of [false, true]) for (const srcFirst of [false, true]) {
    const runtime = dom();
    const script = runtime.document.createElement('script');
    const set = (name, value) => attributes ? script.setAttribute(name, value) : script[name] = value;
    for (const name of srcFirst ? ['src', 'type'] : ['type', 'src']) set(name, name === 'src' ? encoded : 'module');
    runtime.document.head.appendChild(script);
    assertModule(runtime, script);
    runtime.dom.window.close();
  }
});

test('detached script insertion fixes native-assigned module src and retains original source metadata', () => {
  const runtime = dom();
  const script = runtime.document.createElement('script');
  runtime.originalSet.call(script, 'src', encoded);
  runtime.originalSet.call(script, 'type', 'module');
  runtime.originalSet.call(script, 'scramjet-attr-src', 'https://games.example/assets/entry.js?level=1');
  runtime.document.head.prepend(script);
  assertModule(runtime, script);
  assert.equal(script.getAttribute('scramjet-attr-src'), 'https://games.example/assets/entry.js?level=1');
  runtime.dom.window.close();
});

test('relative rewritten module URLs follow the real base tag even when public baseURI is virtualized', () => {
  const runtime = dom();
  Object.defineProperty(runtime.window.Node.prototype, 'baseURI', {
    configurable: true, get() { return 'https://games.example/assets/'; },
  });
  const script = runtime.document.createElement('script');
  script.src = encoded.slice(prefix.length);
  script.type = 'module';
  runtime.document.head.appendChild(script);
  assertModule(runtime, script);
  runtime.dom.window.close();
});

test('a module subtree inserted through a fragment gets the same identity and ordinary scripts keep their URL', () => {
  const runtime = dom();
  const fragment = runtime.document.createDocumentFragment();
  const container = runtime.document.createElement('div');
  container.innerHTML = `<script type="module" src="${encoded}"></script><script src="${encoded}"></script>`;
  fragment.appendChild(container);
  runtime.document.body.replaceChildren(fragment);
  const [module, classic] = runtime.document.querySelectorAll('script');
  assertModule(runtime, module);
  assert.equal(classic.getAttribute('src'), encoded);
  runtime.dom.window.close();
});

test('already marked modules, blobs and unrelated URLs remain unchanged', () => {
  const runtime = dom();
  for (const source of [encoded + '?type=module', 'blob:https://proxy.example/123', 'https://elsewhere.example/file.js']) {
    const script = runtime.document.createElement('script');
    script.type = 'module';
    script.src = source;
    runtime.document.head.append(script);
    assert.equal(script.getAttribute('src'), source);
  }
  runtime.dom.window.close();
});
