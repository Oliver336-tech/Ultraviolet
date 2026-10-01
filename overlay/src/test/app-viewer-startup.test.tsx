import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import AppViewerPage from "@/components/AppViewerPage";

const proxy = vi.hoisted(() => ({ ready: false, arm: vi.fn(), mux: vi.fn(), create: vi.fn(), encode: vi.fn() }));
vi.mock("@/lib/px", () => ({
  pxReady: () => proxy.ready,
  pxCreateFrame: proxy.create,
  pxEncode: proxy.encode,
}));
vi.mock("@/lib/browserInit", () => ({ armPx: proxy.arm }));
vi.mock("@/lib/proxyTarget", () => ({ applyMuxForUrl: proxy.mux }));
vi.mock("@/lib/openTabBridge", () => ({ openProxiedTab: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

beforeEach(() => {
  vi.useFakeTimers();
  proxy.ready = true;
  proxy.arm.mockReset().mockResolvedValue(undefined);
  proxy.mux.mockReset().mockResolvedValue(true);
  proxy.create.mockReset().mockImplementation(() => ({ frame: document.createElement("iframe") }));
  proxy.encode.mockReset().mockImplementation(url => "/afsd123k2/" + encodeURIComponent(url));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("app viewer startup", () => {
  it("waits for actual startup, including a slow startup, before creating a usable frame", async () => {
    const startup = deferred<void>();
    proxy.ready = false;
    proxy.arm.mockReturnValue(startup.promise);
    const result = render(<AppViewerPage url="https://example.org/play" title="Example" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(result.container.querySelector("iframe")).toBeNull();
    expect(proxy.mux).not.toHaveBeenCalled();
    proxy.ready = true;
    await act(async () => { startup.resolve(undefined); });
    const frame = result.container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("/afsd123k2/" + encodeURIComponent("https://example.org/play"));
    expect(frame.title).toBe("Example");
    expect(frame.style.opacity).toBe("1");
    expect(frame.style.pointerEvents).toBe("auto");
  });

  it("shows the actual initialization error and creates no frame", async () => {
    proxy.arm.mockRejectedValue(new Error("Proxy controller initialization timed out"));
    const result = render(<AppViewerPage url="https://example.org/play" />);
    await flush();
    expect(result.getByRole("alert")).toHaveTextContent("Proxy controller initialization timed out");
    expect(proxy.mux).not.toHaveBeenCalled();
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("shows a connection failure when transport selection returns false", async () => {
    proxy.mux.mockResolvedValue(false);
    const result = render(<AppViewerPage url="https://example.org/play" />);
    await flush();
    expect(result.getByRole("alert")).toHaveTextContent("The connection could not start");
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("preserves the error from a rejected transport startup", async () => {
    proxy.mux.mockRejectedValue(new Error("Transport module could not load"));
    const result = render(<AppViewerPage url="https://example.org/play" />);
    await flush();
    expect(result.getByRole("alert")).toHaveTextContent("Transport module could not load");
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("does not navigate a stale URL when its transport resolves after a new URL", async () => {
    const transport = deferred<boolean>();
    proxy.mux.mockImplementation(url => url === "https://old.example/play" ? transport.promise : Promise.resolve(true));
    const result = render(<AppViewerPage url="https://old.example/play" />);
    await flush();
    expect(result.container.querySelector("iframe")).toBeNull();
    result.rerender(<AppViewerPage url="https://new.example/play" />);
    await flush();
    const frame = result.container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toContain(encodeURIComponent("https://new.example/play"));
    await act(async () => { transport.resolve(true); });
    expect(proxy.create).toHaveBeenCalledOnce();
    expect(proxy.encode).toHaveBeenCalledOnce();
    expect(proxy.encode).toHaveBeenCalledWith("https://new.example/play");
    expect(result.container.querySelector("iframe")).toBe(frame);
  });

  it("does not create a frame if the app unmounts during initialization", async () => {
    const startup = deferred<void>();
    proxy.arm.mockReturnValue(startup.promise);
    const result = render(<AppViewerPage url="https://example.org/play" />);
    result.unmount();
    await act(async () => { startup.resolve(undefined); });
    expect(proxy.mux).not.toHaveBeenCalled();
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("does not create or navigate a frame if the app unmounts during transport selection", async () => {
    const transport = deferred<boolean>();
    proxy.mux.mockReturnValue(transport.promise);
    const result = render(<AppViewerPage url="https://example.org/play" />);
    await flush();
    result.unmount();
    await act(async () => { transport.resolve(true); });
    expect(proxy.create).not.toHaveBeenCalled();
    expect(proxy.encode).not.toHaveBeenCalled();
  });

  it("applies the current mute state when a delayed frame launches and loads", async () => {
    const startup = deferred<void>();
    proxy.arm.mockReturnValue(startup.promise);
    const result = render(<AppViewerPage url="https://example.org/play" />);
    fireEvent.click(result.getByTitle("Mute"));
    await act(async () => { startup.resolve(undefined); });
    const frame = result.container.querySelector("iframe")!;
    expect((frame.contentWindow as any).__pzMuted).toBe(true);
    fireEvent.load(frame);
    expect((frame.contentWindow as any).__pzMuted).toBe(true);
    expect(frame.style.pointerEvents).toBe("auto");
  });
});
