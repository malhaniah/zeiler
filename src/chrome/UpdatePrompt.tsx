import { listen } from "@tauri-apps/api/event";
import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, updateInstallNow, updateStatus } from "../lib/ipc";

/**
 * Update UI. The Rust updater downloads signed releases; this prompts when one is
 * ready, and covers the window while it installs. Dismissing a version keeps it quiet
 * until the next launch or a newer release, and it still installs on the next launch.
 */
export function UpdatePrompt() {
  const [ready, setReady] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = ready !== null && dismissed !== ready && !installing;

  useEffect(() => {
    updateStatus()
      .then((s) => setReady(s.ready ?? null))
      .catch(() => {});
    const unlisten = [
      listen<string>("update://ready", (e) => {
        setReady(e.payload);
        setDismissed((version) => (version === e.payload ? version : null));
        setStarting(false);
        setError(null);
      }),
      listen<string>("update://installing", (e) => {
        setStarting(false);
        setInstalling(e.payload);
      }),
      listen<string>("update://failed", (e) => {
        setInstalling(null);
        setStarting(false);
        setError(e.payload);
      }),
    ];
    return () => {
      unlisten.forEach((p) => void p.then((off) => off()));
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const dismiss = () => {
    if (ready) setDismissed(ready);
    setError(null);
  };

  const install = () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    updateInstallNow().catch((e) => {
      setStarting(false);
      setInstalling(null);
      setError(errorMessage(e));
    });
  };

  if (installing) {
    return (
      <div
        role="status"
        className="animate-fade-in fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 bg-canvas"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-edge border-t-accent" />
        <div className="font-display text-[32px] font-medium text-ink">Updating Zeiler</div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink-subtle">
          Installing v{installing} · Zeiler will reopen
        </div>
      </div>
    );
  }

  return (
    <>
      {error && !ready && (
        <div
          role="alert"
          className="fixed bottom-5 right-5 z-[150] flex max-w-sm items-start gap-3 rounded-2xl border border-edge-soft bg-elevated px-4 py-3.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.65)]"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-semibold text-ink">Update failed</span>
            <span className="text-[12px] leading-snug text-ink-subtle">{error}</span>
          </div>
          <button
            aria-label="Dismiss update error"
            onClick={() => setError(null)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-raised hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby="update-title"
        aria-describedby="update-description"
        onCancel={(e) => {
          e.preventDefault();
          dismiss();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
        className="animate-modal-in max-h-[85vh] w-[calc(100%-3rem)] max-w-[440px] overflow-y-auto rounded-[24px] border border-edge-soft bg-elevated p-0 text-ink shadow-[0_30px_80px_-25px_rgba(0,0,0,0.85)] backdrop:bg-black/65 backdrop:backdrop-blur-sm"
      >
        <div className="px-7 py-7">
          <div className="flex items-start justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
              <Download size={20} />
            </div>
            <button
              aria-label="Close update prompt"
              onClick={dismiss}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-6 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-accent">
            Update available
          </div>
          <h2 id="update-title" className="mt-2 font-display text-[30px] font-medium tracking-tight">
            Zeiler v{ready}
          </h2>
          <p id="update-description" className="mt-3 text-[13.5px] leading-relaxed text-ink-muted">
            The new release is downloaded and ready. Restart to update now, or it will install
            automatically the next time you open Zeiler.
          </p>
          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/15 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
              {error}
            </p>
          )}
          <div className="mt-7 flex gap-3">
            <button
              onClick={dismiss}
              className="h-11 rounded-xl border border-edge-soft px-4 text-[13px] font-medium text-ink-muted transition-colors hover:border-edge hover:text-ink"
            >
              Later
            </button>
            <button
              autoFocus
              disabled={starting}
              aria-busy={starting}
              onClick={install}
              className="h-11 flex-1 rounded-xl bg-ink px-4 text-[13px] font-semibold text-canvas transition-transform hover:scale-[1.01] active:scale-[0.98] disabled:cursor-progress disabled:opacity-60"
            >
              {starting ? "Starting update…" : "Restart and update"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
