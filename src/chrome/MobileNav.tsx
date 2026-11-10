import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../lib/store";
import { type RootView, useView } from "../lib/view";
import { type NavEntry, primaryNavigation, secondaryNavigation } from "./navigation";

const MOBILE_VIEWS: RootView[] = ["home", "discover", "movies", "shows"];

export function MobileNav() {
  const { view, setView } = useView();
  const { settings } = useSettings();
  const [moreOpen, setMoreOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const entries = primaryNavigation(settings?.hideAnime, settings?.hideLiveTv);
  const mobile = entries.filter((entry) => MOBILE_VIEWS.includes(entry.view));
  const more = [...entries.filter((entry) => !MOBILE_VIEWS.includes(entry.view)), ...secondaryNavigation];
  const moreActive = more.some((entry) => entry.view === view);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (moreOpen && !dialog.open) dialog.showModal();
    if (!moreOpen && dialog.open) dialog.close();
  }, [moreOpen]);

  const select = (next: RootView) => {
    setMoreOpen(false);
    setView(next);
  };

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-[65] grid grid-cols-5 border-t border-edge-soft bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md xl:hidden"
      >
        {mobile.map((entry) => (
          <MobileNavItem key={entry.view} entry={entry} active={view === entry.view} onSelect={select} />
        ))}
        <button
          aria-label="More navigation"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={`flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            moreActive ? "text-ink" : "text-ink-subtle"
          }`}
        >
          <MoreHorizontal size={21} strokeWidth={moreActive ? 2.2 : 1.7} />
          <span className="truncate">More</span>
        </button>
      </nav>
      <dialog
        ref={dialogRef}
        aria-label="More navigation"
        onCancel={(e) => {
          e.preventDefault();
          setMoreOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setMoreOpen(false);
        }}
        className="mb-0 mt-auto w-full max-w-none rounded-t-[24px] border border-edge-soft bg-elevated p-0 text-ink backdrop:bg-black/65 xl:hidden"
      >
        <div className="px-5 pb-8 pt-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[24px] font-medium">More</h2>
            <button
              aria-label="Close navigation"
              onClick={() => setMoreOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-raised hover:text-ink"
            >
              <X size={19} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {more.map((entry) => (
              <MoreNavItem key={entry.view} entry={entry} active={view === entry.view} onSelect={select} />
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}

function MobileNavItem({ entry, active, onSelect }: { entry: NavEntry; active: boolean; onSelect: (view: RootView) => void }) {
  const Icon = entry.icon;
  return (
    <button
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(entry.view)}
      className={`flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium ${
        active ? "text-ink" : "text-ink-subtle"
      }`}
    >
      <Icon size={21} strokeWidth={active ? 2.2 : 1.7} />
      <span className="truncate">{entry.label}</span>
    </button>
  );
}

function MoreNavItem({ entry, active, onSelect }: { entry: NavEntry; active: boolean; onSelect: (view: RootView) => void }) {
  const Icon = entry.icon;
  return (
    <button
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(entry.view)}
      className={`flex h-14 items-center gap-3 rounded-xl px-4 text-left text-[14px] ${
        active ? "bg-raised text-ink" : "text-ink-muted hover:bg-raised/60 hover:text-ink"
      }`}
    >
      <Icon size={20} strokeWidth={1.7} />
      {entry.label}
    </button>
  );
}
