/**
 * Minimize, maximize/restore and close for Zeiler's window, which has no OS title bar
 * (`decorations: false`). Drawn in the shell's Topbar and in both player screens, which
 * cover the shell; hidden while the window is fullscreen (Escape and `f` leave it). Not
 * drawn outside Tauri (the browser smoke tests).
 */
import { useEffect, useState } from "react";

const IN_TAURI = "__TAURI_INTERNALS__" in window;

export function WindowControls() {
  return IN_TAURI ? <Controls /> : null;
}

function Controls() {
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const refresh = async () => {
        const [max, full] = await Promise.all([
          win.isMaximized().catch(() => false),
          win.isFullscreen().catch(() => false),
        ]);
        if (disposed) return;
        setMaximized(max);
        setFullscreen(full);
      };
      void refresh();
      const stop = await win.onResized(() => void refresh());
      // unmounted while subscribing: let go at once
      if (disposed) stop();
      else unlisten = stop;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (fullscreen) return null;

  const act = async (action: "minimize" | "toggleMaximize" | "close") => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  };

  const buttonClass =
    "flex h-10 w-11 items-center justify-center rounded-xl bg-elevated/70 text-ink-muted transition-colors duration-150 hover:bg-elevated hover:text-ink";

  return (
    <div className="ml-1 flex shrink-0 items-center gap-1.5">
      <button className={buttonClass} onClick={() => void act("minimize")} aria-label="Minimize">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 6.5h7" />
        </svg>
      </button>
      <button
        className={buttonClass}
        onClick={() => void act("toggleMaximize")}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4">
          {maximized ? (
            <>
              <rect x="3" y="4.5" width="5.5" height="5.5" rx="1.2" />
              <path d="M5 3h4.5A1.5 1.5 0 0 1 11 4.5V9" />
            </>
          ) : (
            <rect x="3" y="3" width="7" height="7" rx="1.2" />
          )}
        </svg>
      </button>
      <button className={buttonClass} onClick={() => void act("close")} aria-label="Close">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3.5 3.5l6 6M9.5 3.5l-6 6" />
        </svg>
      </button>
    </div>
  );
}
