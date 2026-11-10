/**
 * Keeps the built-in (embedded) video surface right after window changes.
 *
 * On Windows the video is a native child window under the transparent WebView2.
 * Fullscreen, resizing, moving between monitors and DPI changes can leave it at the
 * old size, lift it above the webview or make WebView2 paint its background again,
 * and the window settles over a second or two. So after each such change the page
 * re-sends the video rectangle and calls `player_surface_refresh` on a short kick
 * schedule rather than once. Ordinary moves wait until the window stops: refreshing
 * for every move event redraws mpv and refocuses WebView2 throughout the drag.
 * (The idea and the schedule's shape follow Harbor's `use-fullscreen.ts`, MIT — see
 * THIRD-PARTY-NOTICES.md.)
 */
import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { playerSurfaceRefresh } from "../../lib/player-ipc";

/** Milliseconds after a window change at which the surface is re-asserted. */
export const SURFACE_KICKS_MS = [0, 60, 200, 500, 1000, 2000] as const;
const MOVE_SETTLE_MS = 150;

/**
 * While `enabled` (the embedded backend is playing), re-sync the surface after every
 * resize and scale change, and once movement settles. Returns `kick`, for changes the
 * page makes itself (fullscreen toggles). A new kick restarts the schedule.
 */
export function useSurfaceSync(enabled: boolean, sendGeometry: () => void): () => void {
  const timers = useRef<number[]>([]);
  const moveTimer = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const cancel = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    if (moveTimer.current !== null) window.clearTimeout(moveTimer.current);
    moveTimer.current = null;
  }, []);

  const kick = useCallback(() => {
    if (!enabledRef.current) return;
    cancel();
    timers.current = SURFACE_KICKS_MS.map((delay) =>
      window.setTimeout(() => {
        if (!enabledRef.current) return;
        sendGeometry();
        void playerSurfaceRefresh().catch(() => undefined);
      }, delay),
    );
  }, [cancel, sendGeometry]);

  const afterMove = useCallback(() => {
    if (!enabledRef.current) return;
    if (moveTimer.current !== null) window.clearTimeout(moveTimer.current);
    moveTimer.current = window.setTimeout(() => {
      moveTimer.current = null;
      kick();
    }, MOVE_SETTLE_MS);
  }, [kick]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const win = getCurrentWindow();
    for (const subscription of [
      { subscribe: (h: () => void) => win.onResized(h), handler: kick },
      { subscribe: (h: () => void) => win.onMoved(h), handler: afterMove },
      { subscribe: (h: () => void) => win.onScaleChanged(h), handler: kick },
    ]) {
      subscription
        .subscribe(subscription.handler)
        .then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)))
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
      cancel();
    };
  }, [enabled, kick, afterMove, cancel]);

  return kick;
}
