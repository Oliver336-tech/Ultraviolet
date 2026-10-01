// Runtime setup follows MercuryWorkshop/Scramjet-App f6f83cbc (AGPL-3.0).
// Original PeteZah and game credits are available at /edition.
(() => {
  const host = document.getElementById('viewer');
  const error = document.getElementById('error');
  let controller;
  let initialization;
  let request = 0;

  function unwrap(raw) {
    let value = String(raw || '').trim();
    for (let i = 0; i < 5; i++) {
      const parsed = new URL(value || '/', location.origin);
      if (parsed.origin === location.origin && parsed.pathname === '/iframe.html' && parsed.searchParams.has('url')) {
        value = parsed.searchParams.get('url');
        continue;
      }
      if (/\/(?:static\/)?(?:google-|scram-|libcurl-)?embed\.html$/.test(parsed.pathname) && parsed.hash) {
        value = parsed.hash.slice(1);
        continue;
      }
      const mochi = value.match(/^\/(?:!!|f\/g|n\/m)\/(https?:\/\/|hs\/|ht\/)(.*)$/);
      if (mochi) value = (mochi[1] === 'ht/' ? 'http://' : mochi[1] === 'hs/' ? 'https://' : mochi[1]) + mochi[2];
      break;
    }
    if (!value) value = 'https://www.google.com/';
    if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) value = 'https://' + value;
    const target = new URL(value, location.origin);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Enter an HTTP or HTTPS address.');
    return target;
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      const { ScramjetController } = $scramjetLoadController();
      controller = new ScramjetController({ prefix: '/afsd123k2/', files: {
        wasm: '/scram/scramjet.wasm.wasm', all: '/scram/scramjet.all.js?v=scramjet-1.1.0-r2', sync: '/scram/scramjet.sync.js'
      } });
      await controller.init();
      await navigator.serviceWorker.register('/1k123.js?v=scramjet-1.1.0-r2', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The connection could not start. Reload and try again.')), 15000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      const connection = new BareMux.BareMuxConnection('/baremux/worker.js');
      await connection.setTransport('/libcurl/index.mjs', [{ websocket: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/websocket/' }]);
    })().catch((failure) => { initialization = undefined; throw failure; });
    return initialization;
  }

  async function open() {
    const current = ++request;
    try {
      const target = unwrap(new URL(location.href).searchParams.get('url') || location.hash.slice(1));
      error.hidden = true;
      if (target.origin === location.origin && target.pathname.startsWith('/storage/ag/')) {
        const frame = document.createElement('iframe');
        frame.title = 'Game';
        frame.allow = 'fullscreen; autoplay; gamepad; cross-origin-isolated';
        frame.src = target.href;
        host.replaceChildren(frame);
        return;
      }
      await initialize();
      if (current !== request) return;
      const frame = controller.createFrame();
      frame.frame.title = 'Game';
      frame.frame.allow = 'fullscreen; autoplay; gamepad; cross-origin-isolated';
      host.replaceChildren(frame.frame);
      frame.go(target.href);
    } catch (failure) {
      if (current !== request) return;
      error.textContent = failure.message || 'The page could not be opened.';
      error.hidden = false;
    }
  }
  window.addEventListener('hashchange', open);
  void open();
})();
