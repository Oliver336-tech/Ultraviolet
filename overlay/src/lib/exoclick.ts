/** Ad-free fork: compatibility functions never contact an advertising service. */
type Context = "game" | "app" | "vm";
export type AdGateResult = { show: false; reason: string };
export async function requestAdGate(_context: Context): Promise<AdGateResult> {
  return { show: false, reason: "ad-free" };
}
export function armAdAudio() {}
export async function playVideoAd(_context?: Context): Promise<"skip"> { return "skip"; }
export async function runInterstitial(_context: Context): Promise<"skipped"> { return "skipped"; }
export function stopVideoAd() {}
export const CONTAINER_ID = "pz-video-ad-root";
