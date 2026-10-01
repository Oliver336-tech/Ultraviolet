import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useBrowserState } from "@/hooks/useBrowserState";
import { Toaster } from "@/components/ui/toaster";

const proxy = vi.hoisted(() => ({ ready: false, arm: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/px", () => ({
  pxReady: () => proxy.ready,
  pxCreateFrame: proxy.create,
  pxEncode: (url: string) => "/afsd123k2/" + encodeURIComponent(url),
}));
vi.mock("@/lib/browserInit", () => ({ armPx: proxy.arm }));
vi.mock("@/lib/proxyTarget", () => ({ applyMuxForUrl: async () => true }));

let resolveStartup: () => void;
let rejectStartup: (error: Error) => void;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  proxy.ready = false;
  proxy.create.mockReset().mockImplementation(() => ({
    frame: document.createElement("iframe"),
    destroy: vi.fn(),
  }));
  const startup = new Promise<void>((resolve, reject) => {
    resolveStartup = () => { proxy.ready = true; resolve(); };
    rejectStartup = reject;
  });
  proxy.arm.mockReset().mockReturnValue(startup);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("browser startup", () => {
  it("opens a requested page even when startup takes longer than 15 seconds", async () => {
    const { result } = renderHook(() => useBrowserState());
    act(() => { result.current.navigateToUrl("example.org"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(proxy.create).not.toHaveBeenCalled();

    await act(async () => { resolveStartup(); });
    expect(result.current.activeTab?.url).toBe("https://example.org");
    expect(result.current.activeTab?.frame?.frame.src).toContain(encodeURIComponent("https://example.org"));
  });

  it("opens a new external tab after a delayed startup", async () => {
    const { result } = renderHook(() => useBrowserState());
    act(() => { result.current.addTab("https://example.org/new"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    await act(async () => { resolveStartup(); });
    expect(result.current.activeTab?.url).toBe("https://example.org/new");
    expect(result.current.activeTab?.frame?.frame.src).toContain(encodeURIComponent("https://example.org/new"));
  });

  it("shows a useful message when startup fails instead of silently dropping the page", async () => {
    render(<Toaster />);
    const { result } = renderHook(() => useBrowserState());
    act(() => { result.current.navigateToUrl("example.org"); });
    await act(async () => { rejectStartup(new Error("startup failed")); });
    expect(screen.getByText("Couldn't open page")).toBeVisible();
    expect(screen.getByText("The connection couldn't start. Please try again.")).toBeVisible();
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("does not create a late frame for a closed tab", async () => {
    const { result } = renderHook(() => useBrowserState());
    let tabId = "";
    act(() => { tabId = result.current.addTab("https://example.org/closed").id; });
    act(() => { result.current.closeTab(tabId); });
    await act(async () => { resolveStartup(); await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.tabs.some((tab) => tab.id === tabId)).toBe(false);
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("uses the newest address when a user changes it during startup", async () => {
    const { result } = renderHook(() => useBrowserState());
    act(() => { result.current.navigateToUrl("first.example.org"); });
    act(() => { result.current.navigateToUrl("last.example.org"); });
    await act(async () => { resolveStartup(); await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.activeTab?.url).toBe("https://last.example.org");
    expect(proxy.create).toHaveBeenCalledOnce();
    expect(result.current.activeTab?.frame?.frame.src).toContain(encodeURIComponent("https://last.example.org"));
  });

  it("keeps an internal page selected when an earlier external request finishes", async () => {
    const { result } = renderHook(() => useBrowserState());
    act(() => { result.current.navigateToUrl("example.org"); });
    act(() => { result.current.navigateToUrl("petezah://games"); });
    await act(async () => { resolveStartup(); await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.activeTab?.url).toBe("petezah://games");
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it("does not create a frame after the browser has unmounted", async () => {
    const { result, unmount } = renderHook(() => useBrowserState());
    act(() => { result.current.addTab("https://example.org/removed"); });
    unmount();
    await act(async () => { resolveStartup(); await vi.advanceTimersByTimeAsync(100); });
    expect(proxy.create).not.toHaveBeenCalled();
  });
});
