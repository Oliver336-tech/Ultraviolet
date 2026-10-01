import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@/lib/px", () => ({
  PX: { sw: "/1k123.js", muxWorker: "/m4thx/worker.js", tunMod: "/e7px/index.mjs", muxMod: "/m4thx/index.mjs", curlMod: "/l9cx/index.mjs", prefix: "/afsd123k2/" },
  ENGINE_GEN: "test-engine",
  loadCtrlFactory: () => () => ({ Controller: class { init = engine.init; } }),
  ctrlClassName: () => "Controller",
  getMuxRoot: () => ({}),
  openMuxConnection: () => ({ bindTransfer: async () => {} }),
  setMuxTransport: async () => {},
  muxSetName: () => "bindTransfer",
  cfgStreamUrl: () => undefined,
  defaultStreamUrl: () => "wss://test.invalid/api/websocket/",
  defaultEdgeUrl: () => "https://test.invalid/api/edge/",
}));

let serviceWorker: EventTarget & {
  controller: object | null;
  ready: Promise<object>;
  register: ReturnType<typeof vi.fn>;
  getRegistrations: ReturnType<typeof vi.fn>;
};
let runtime: typeof import("@/lib/browserInit");

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  engine.init.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  localStorage.setItem("pz-eg", "test-engine");
  delete (window as any).__pz;
  delete (window as any).__pzEgMig;
  delete (window as any).__PZ_CACHE__;
  delete (window as any).__PZ_EG__;
  window.__browserInitialized = false;
  const registration = { installing: null, update: vi.fn().mockResolvedValue(undefined) };
  serviceWorker = Object.assign(new EventTarget(), {
    controller: { postMessage: vi.fn() },
    ready: Promise.resolve(registration),
    register: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue([]),
  });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  vi.stubGlobal("caches", { keys: async () => [] });
  // Only storage health is stubbed; each test exercises the startup promise and
  // real service-worker readiness checks, including rejection and timeout paths.
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: any = { result: { version: 1, objectStoreNames: { contains: () => true }, close: () => {} } };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  runtime = await import("@/lib/browserInit");
  runtime.armProxySession();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start() {
  return runtime.initBrowser();
}

describe("proxy startup readiness", () => {
  it("does not publish a controller as ready after service worker registration fails", async () => {
    serviceWorker.register.mockRejectedValue(new Error("Registration denied"));
    await expect(start()).rejects.toThrow("Registration denied");
    expect((window as any).__pz).toBeUndefined();
    expect(engine.init).toHaveBeenCalledOnce();
  });

  it("rejects a service worker that never becomes ready within the deadline", async () => {
    serviceWorker.ready = new Promise(() => {});
    const attempt = start();
    const result = expect(attempt).rejects.toThrow("did not become ready");
    await vi.advanceTimersByTimeAsync(10001);
    await result;
    expect((window as any).__pz).toBeUndefined();
  });

  it("requires an active controller before initializing a proxy frame", async () => {
    serviceWorker.controller = null;
    const attempt = start();
    const result = expect(attempt).rejects.toThrow("did not take control");
    await vi.advanceTimersByTimeAsync(10001);
    await result;
    expect(engine.init).toHaveBeenCalledOnce();
    expect((window as any).__pz).toBeUndefined();
  });

  it("finishes startup after the service worker controls the page", async () => {
    await start();
    expect(engine.init).toHaveBeenCalledOnce();
    expect((window as any).__pz).toBeDefined();
    expect(window.__browserInitialized).toBe(true);
  });
});
