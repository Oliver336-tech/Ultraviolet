import { originHttpHost, originWsHost, svgDirPath } from './siteOrigin';

function dir() {
  return typeof window !== 'undefined' && (window as any).__PZ_ORIGIN__ ? svgDirPath() : '/';
}

export const ENGINE_GEN = 'scramjet-1.1.0-r2';

export const PX = {
  get prefix() { return dir() + 'afsd123k2/'; },
  get core() { return dir() + 'scram/'; },
  get mux() { return dir() + 'baremux/'; },
  stream: '/api/websocket/',
  edge: '/api/edge/',
  get sw() { return dir() + '1k123.js'; },
  get coreAll() { return dir() + 'scram/scramjet.all.js?v=' + encodeURIComponent(ENGINE_GEN); },
  get coreSync() { return dir() + 'scram/scramjet.sync.js'; },
  get coreWasm() { return dir() + 'scram/scramjet.wasm.wasm'; },
  get muxIndex() { return dir() + 'baremux/index.js'; },
  get muxMod() { return dir() + 'baremux/index.mjs'; },
  get muxWorker() { return dir() + 'baremux/worker.js'; },
  get tunMod() { return dir() + 'epoxy/index.mjs'; },
  get curlMod() { return dir() + 'libcurl/index.mjs'; },
};

export function getPx(): any { return (window as any).__pz; }
export function pxEncode(url: string): string {
  const controller = getPx();
  if (!controller) return 'about:blank';
  try { return controller.encodeUrl(url); } catch { return 'about:blank'; }
}
export function pxDecode(url: string): string {
  const controller = getPx();
  if (!controller) return url;
  try { return controller.decodeUrl(url); } catch { return url; }
}
export function pxCreateFrame(): any { return getPx()?.createFrame() ?? null; }
export function pxReady(): boolean { return !!getPx(); }
export async function waitPx(timeoutMs = 8000): Promise<boolean> {
  if (getPx()) return true;
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (getPx() || Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(!!getPx());
      }
    }, 50);
  });
}
export function loadCtrlFactory(): any { return (window as any).$scramjetLoadController; }
export function ctrlClassName(): string { return 'ScramjetController'; }
export function getMuxRoot(): any { return (window as any).BareMux; }
export function openMuxConnection(workerPath: string): any {
  const root = getMuxRoot();
  return root ? new root.BareMuxConnection(workerPath) : null;
}
export function muxSetName(): string { return 'setTransport'; }
export function cfgStreamUrl(cfg: any): string | undefined { return cfg?.wispurl || cfg?.streamurl; }
export async function setMuxTransport(connection: any, modulePath: string, streamUrl: string): Promise<void> {
  if (!connection) throw new Error('Proxy transport is unavailable');
  await connection.setTransport(modulePath, [{ websocket: streamUrl }]);
}
export function defaultStreamUrl(): string { return originWsHost() + PX.stream; }
export function defaultEdgeUrl(): string { return originHttpHost() + PX.edge; }
