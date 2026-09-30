import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/verify.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((code) => code.includes('async function refreshStatus'));

async function boot(status, options = {}) {
  const dom = new JSDOM(html, { url: 'https://edition.example/verify' });
  const requests = [];
  const redirects = [];
  vm.runInNewContext(script, {
    document: dom.window.document,
    location: { replace: (url) => redirects.push(url) },
    setTimeout: (run) => run(),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/status')) return { ok: options.statusOk !== false, json: async () => status };
      return { ok: true, json: async () => ({ success: true }) };
    },
  }, { timeout: 1000 });
  await new Promise((resolve) => setImmediate(resolve));
  return { dom, requests, redirects, doc: dom.window.document };
}

test('a visitor who does not need a challenge can agree and continue', async () => {
  const view = await boot({ needsCaptcha: false, accepted: false, version: 'edition-v1' });
  try {
    const agree = view.doc.getElementById('agree');
    const button = view.doc.getElementById('continue');
    assert.equal(button.disabled, true);
    assert.equal(view.doc.querySelector('.widget-wrap').style.display, 'none');
    agree.checked = true;
    agree.dispatchEvent(new view.dom.window.Event('change'));
    assert.equal(button.disabled, false);
    button.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(view.requests[1].url, '/api/legal/accept');
    assert.deepEqual(JSON.parse(view.requests[1].init.body), { accepted: true, version: 'edition-v1' });
    assert.deepEqual(view.redirects, ['/']);
  } finally { view.dom.window.close(); }
});

test('a required challenge keeps Continue disabled until the real solve event', async () => {
  const view = await boot({ needsCaptcha: true, accepted: false, version: 'edition-v1' });
  try {
    const agree = view.doc.getElementById('agree');
    agree.checked = true;
    agree.dispatchEvent(new view.dom.window.Event('change'));
    assert.equal(view.doc.getElementById('continue').disabled, true);
    view.doc.getElementById('cap').dispatchEvent(new view.dom.window.CustomEvent('solve'));
    assert.equal(view.doc.getElementById('continue').disabled, false);
  } finally { view.dom.window.close(); }
});

test('an accepted visitor who needs no challenge returns to the app', async () => {
  const view = await boot({ needsCaptcha: false, accepted: true });
  try { assert.deepEqual(view.redirects, ['/']); }
  finally { view.dom.window.close(); }
});

test('a status failure is visible and cannot unlock the page', async () => {
  const view = await boot({}, { statusOk: false });
  try {
    assert.equal(view.doc.getElementById('continue').disabled, true);
    assert.match(view.doc.getElementById('status').textContent, /Could not check verification/);
    assert.deepEqual(view.redirects, []);
  } finally { view.dom.window.close(); }
});
