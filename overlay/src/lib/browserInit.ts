import {
  PX, ENGINE_GEN, loadCtrlFactory, ctrlClassName, openMuxConnection,
  setMuxTransport, cfgStreamUrl, defaultStreamUrl,
} from './px';

declare global {
  interface Window {
    __pz: any;
    __browserInitialized: boolean;
  }
}

function withTimeout<T>(job: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    job.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

let proxyArmed = false;
let proxyArmWaiters: Array<() => void> = [];
function markProxyArmed() {
  if (proxyArmed) return;
  proxyArmed = true;
  for (const resolve of proxyArmWaiters.splice(0)) resolve();
}
if (typeof document !== 'undefined') {
  for (const event of ['pointerdown', 'keydown', 'click']) {
    document.addEventListener(event, markProxyArmed, { capture: true, passive: true });
  }
}
export function armProxySession() { markProxyArmed(); }
async function waitForProxyArm(): Promise<void> {
  if (proxyArmed) return;
  await withTimeout(new Promise<void>((resolve) => proxyArmWaiters.push(resolve)), 120000, 'Proxy startup needs a user action');
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    try {
      const request = indexedDB.deleteDatabase(name);
      const finish = () => { clearTimeout(timer); resolve(); };
      request.onsuccess = finish;
      request.onerror = finish;
    } catch { clearTimeout(timer); resolve(); }
  });
}

async function migrateEngineOnce(): Promise<void> {
  const stamp = (window as any).__PZ_EG__ || [ENGINE_GEN, (window as any).__PZ_CACHE__].filter(Boolean).join('-');
  if (localStorage.getItem('pz-eg') === stamp) return;
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  // A new generation removes the old renamed engine databases. Let the real
  // ScramjetController create its own schema instead of duplicating it here.
  await Promise.all(['$scramjet', '$voltedge', '$duskline'].map(deleteDb));
  localStorage.setItem('pz-eg', stamp);
}

async function registerSw(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('This browser does not support the proxy service worker');
  const registration = await withTimeout(navigator.serviceWorker.register(
    PX.sw + '?v=' + encodeURIComponent(ENGINE_GEN),
    { updateViaCache: 'none', scope: (window as any).__PZ_ORIGIN__ ? new URL('.', location.href).pathname : '/' },
  ), 10000, 'Proxy service worker registration timed out');
  try { await withTimeout(registration.update(), 5000, 'Proxy service worker update timed out'); } catch {}
  if (registration.installing) {
    const installing = registration.installing;
    await withTimeout(new Promise<void>((resolve, reject) => {
      const check = () => {
        if (installing.state === 'activated') resolve();
        else if (installing.state === 'redundant') reject(new Error('Proxy service worker could not activate'));
      };
      installing.addEventListener('statechange', check);
      check();
    }), 10000, 'Proxy service worker activation timed out');
  }
  await withTimeout(navigator.serviceWorker.ready, 10000, 'Proxy service worker did not become ready');
  await withTimeout(new Promise<void>((resolve) => {
    if (navigator.serviceWorker.controller) return resolve();
    const check = () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.removeEventListener('controllerchange', check);
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', check);
    check();
  }), 10000, 'Proxy service worker did not take control of this page');
}

async function setupMux(): Promise<void> {
  const connection = openMuxConnection(PX.muxWorker);
  if (!connection) throw new Error('Proxy transport is unavailable');
  await setMuxTransport(connection, PX.curlMod, cfgStreamUrl((window as any)._CONFIG) || defaultStreamUrl());
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let script = document.querySelector(`script[data-px-src="${src}"]`) as HTMLScriptElement | null;
    if (script?.dataset.loaded === '1') return resolve();
    if (script?.dataset.failed === '1') { script.remove(); script = null; }
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.pxSrc = src;
    }
    const element = script;
    element.addEventListener('load', () => { element.dataset.loaded = '1'; resolve(); }, { once: true });
    element.addEventListener('error', () => { element.dataset.failed = '1'; reject(new Error('Proxy script could not load')); }, { once: true });
    if (!element.isConnected) document.head.appendChild(element);
  });
}

let ensurePromise: Promise<void> | null = null;
let initializationPromise: Promise<void> | null = null;
export async function armPx(): Promise<void> {
  if ((window as any).__pzEgMig) throw new Error('Proxy storage is updating. Reload the page after the update finishes');
  if (window.__pz) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await waitForProxyArm();
    await withTimeout(migrateEngineOnce(), 20000, 'Proxy storage update timed out');
    await withTimeout(loadScriptOnce(PX.muxIndex), 10000, 'Proxy transport script did not load');
    await withTimeout(loadScriptOnce(PX.coreAll), 10000, 'Proxy controller script did not load');
    await initBrowser();
  })().catch((error) => { ensurePromise = null; throw error; });
  return ensurePromise;
}

export async function initBrowser(): Promise<void> {
  if (window.__pz) return;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    await waitForProxyArm();
    await withTimeout(migrateEngineOnce(), 20000, 'Proxy storage update timed out');
    const factory = loadCtrlFactory();
    if (typeof factory !== 'function') throw new Error('Proxy controller is unavailable');
    const Controller = factory()[ctrlClassName()];
    if (!Controller) throw new Error('Proxy controller is unavailable');
    const controller = new Controller({
      prefix: PX.prefix,
      files: { wasm: PX.coreWasm, all: PX.coreAll, sync: PX.coreSync },
    });
    // Follow the official demo: persist real controller config before installing
    // the canonical worker, then initialize the same-origin libcurl transport.
    await withTimeout(controller.init(), 10000, 'Proxy controller initialization timed out');
    await registerSw();
    await withTimeout(setupMux(), 15000, 'Proxy transport could not start');
    window.__pz = controller;
    window.__browserInitialized = true;
  })().catch((error) => {
    initializationPromise = null;
    window.__browserInitialized = false;
    throw error;
  });
  return initializationPromise;
}
