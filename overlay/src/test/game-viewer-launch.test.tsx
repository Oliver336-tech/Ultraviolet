import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import GameViewerPage from "@/components/GameViewerPage";
import AppViewerPage from "@/components/AppViewerPage";

const proxy = vi.hoisted(() => ({ ready: false, arm: vi.fn(), openNative: vi.fn(), openProxy: vi.fn() }));
vi.mock("@/lib/px", () => ({
  pxReady: () => proxy.ready,
  pxCreateFrame: () => ({ frame: document.createElement("iframe") }),
  pxEncode: (url: string) => "/afsd123k2/" + encodeURIComponent(url),
}));
vi.mock("@/lib/browserInit", () => ({ armPx: proxy.arm }));
vi.mock("@/lib/proxyTarget", () => ({
  applyMuxForUrl: async () => true,
  unwrapPlayUrl: (url: string) => url,
}));
vi.mock("@/lib/openTabBridge", () => ({ openNativeWindow: proxy.openNative, openProxiedTab: proxy.openProxy }));

beforeEach(() => {
  vi.useFakeTimers();
  proxy.ready = false;
  proxy.arm.mockReset().mockResolvedValue(undefined);
  proxy.openNative.mockReset();
  proxy.openProxy.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ad-free viewer launch", () => {
  for (const [kind, Viewer] of [["game", GameViewerPage], ["app", AppViewerPage]] as const) {
    it(`shows the ${kind} frame when the proxy becomes ready after the first render`, async () => {
      const url = "https://example.org/play";
      const result = render(<Viewer url={url} title="Test player" />);
      expect(result.container.querySelector("iframe")).toBeNull();

      proxy.ready = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      const frame = result.container.querySelector("iframe")!;
      expect(frame).not.toBeNull();
      expect(frame.getAttribute("src")).toBe("/afsd123k2/" + encodeURIComponent(url));
      expect(frame.style.opacity).toBe("1");
      expect(frame.style.pointerEvents).toBe("auto");

      fireEvent.load(frame);
      expect(frame.style.opacity).toBe("1");
      expect(frame.style.pointerEvents).toBe("auto");
    });
  }

  it("plays Precision inline and opens its working path only on an explicit click", () => {
    const url = "/storage/ag/originals/precision/index.html";
    const result = render(<GameViewerPage url={url} title="Precision" />);
    const frame = result.container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(url);
    expect(frame.style.opacity).toBe("1");
    expect(proxy.arm).not.toHaveBeenCalled();
    expect(proxy.openNative).not.toHaveBeenCalled();

    fireEvent.click(result.getByTitle("Open in new tab"));
    expect(proxy.openNative).toHaveBeenCalledOnce();
    expect(proxy.openNative).toHaveBeenCalledWith(url);
  });
});
