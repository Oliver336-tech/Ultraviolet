/** Ad-free fork: games/apps launch immediately without an advertising gate. */
export type InterstitialPhase = "checking" | "ad" | "loading" | "ready";
export function useInterstitialUnlock(_context: "game" | "app" | "vm", _enabled = true) {
  return { unlocked: true, phase: "ready" as InterstitialPhase, finishLoading: () => {}, hadAd: false };
}
export function InterstitialOverlay(_props: {
  phase: InterstitialPhase;
  showBanner?: boolean;
  title?: string;
  onLoadingDone?: () => void;
  quickSplash?: boolean;
}) { return null; }
