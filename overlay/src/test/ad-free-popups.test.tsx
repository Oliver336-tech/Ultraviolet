import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import AdViewerPage from "@/components/AdViewerPage";
import { sealPlayerPopups } from "@/lib/sealPlayerPopups";

vi.mock("@/lib/px", () => ({
  getPx: () => null,
  PX: { prefix: "/proxy/" },
  pxEncode: (url: string) => "/proxy/" + encodeURIComponent(url),
}));
vi.mock("@/lib/uiMarks", () => ({ hrefs: { modeP: () => "proxy" } }));

import { emitOpenTab, installFrameOpenTrap, installParentOpenTrap, openNativeWindow } from "@/lib/openTabBridge";

const nativeOpen = vi.fn(() => null);
let openListener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete (window as any).__pzParentOpenTrap;
  delete (window as any).__pzNativeOpen;
  window.open = nativeOpen as typeof window.open;
  nativeOpen.mockClear();
  openListener = vi.fn();
  window.addEventListener("petezah-open-tab", openListener);
});
afterEach(() => {
  window.removeEventListener("petezah-open-tab", openListener);
  delete (window as any).__pzParentOpenTrap;
  delete (window as any).__pzNativeOpen;
});

describe("ad-free navigation", () => {
  it("blocks known advertising URLs without creating tabs or native windows", () => {
    installParentOpenTrap();
    expect(window.open("https://ads.exoclick.com/creative", "_blank")).toBeNull();
    expect(openNativeWindow("https://doubleclick.net/ad")).toBeNull();
    emitOpenTab({ url: "https://example.org/", mode: "ad" });
    expect(openListener).not.toHaveBeenCalled();
    expect(nativeOpen).not.toHaveBeenCalled();
  });
  it("routes a legitimate external link into a proxy tab", () => {
    installParentOpenTrap();
    window.open("https://example.org/help", "_blank", "noopener,noreferrer");
    expect(openListener).toHaveBeenCalledOnce();
    expect(openListener.mock.calls[0][0].detail).toEqual({ url: "https://example.org/help", mode: "proxy", soft: false });
    expect(nativeOpen).not.toHaveBeenCalled();
  });
  it("keeps explicit native game links working", () => {
    installParentOpenTrap();
    openNativeWindow("/storage/ag/game/index.html");
    expect(nativeOpen).toHaveBeenCalledWith("/storage/ag/game/index.html", "_blank", "noopener,noreferrer");
  });
  it("blocks ads requested by an embedded frame", () => {
    installParentOpenTrap();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    installFrameOpenTrap(frame);
    expect(frame.contentWindow!.open("https://doubleclick.net/ad", "_blank")).toBeNull();
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(openListener).not.toHaveBeenCalled();
    frame.remove();
  });
  it("does not load a former sponsored URL when restoring an ad tab", () => {
    const result = render(<AdViewerPage url="https://example.org/former-ad" />);
    expect(result.container.querySelector("iframe")).toBeNull();
    expect(result.getByText("Advertising is disabled in this edition.")).toBeTruthy();
    result.unmount();
  });
  it("patches links in the embedded document's own realm while keeping normal links", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    sealPlayerPopups(frame);
    const link = frame.contentDocument!.createElement("a");
    link.setAttribute("href", "https://doubleclick.net/ad");
    expect(link.getAttribute("href")).toBe("javascript:void(0)");
    link.setAttribute("href", "https://example.org/help");
    expect(link.getAttribute("href")).toBe("https://example.org/help");
    link.setAttribute("target", "_blank");
    expect(link.getAttribute("target")).toBe("_self");
    frame.remove();
  });
});
