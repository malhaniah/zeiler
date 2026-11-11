import { ArrowLeft, Search } from "lucide-react";
import { useEffect } from "react";
import zeilerLogo from "../assets/zeiler-logo-white.png";
import { playerActive } from "../lib/playback-handoff";
import { useSearch } from "../lib/store";
import { useView } from "../lib/view";
import { ProfileChip } from "../views/profiles/ProfileChip";
import { WindowControls } from "./WindowControls";
import { secondaryNavigation } from "./navigation";

export function Topbar() {
  const { canGoBack, goBack, top, view, setView } = useView();
  const { setOpen } = useSearch();

  // "/" opens search anywhere (except while typing, or under the Player screen, where
  // the shell is hidden and the overlay would steal the player's keyboard focus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || playerActive()) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (top.kind === "picker") return null;

  return (
    <header className="fixed left-0 right-0 top-0 z-[55] h-16 sm:h-20 xl:left-60">
      <div
        data-tauri-drag-region
        className="relative z-10 flex h-full items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8"
      >
        {canGoBack && (
          <button
            aria-label="Back"
            onClick={goBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-edge-soft/60 bg-canvas/85 text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <button
          aria-label="Zeiler home"
          onClick={() => setView("home")}
          className="flex shrink-0 items-center gap-2 text-ink xl:hidden"
        >
          <img src={zeilerLogo} alt="" className="h-9 w-9 sm:h-10 sm:w-10" />
          <span className="hidden font-brand text-[27px] font-medium tracking-tight sm:inline">
            Zeiler
          </span>
        </button>

        <div className="flex-1" data-tauri-drag-region />
        <button
          aria-label="Search movies and shows"
          onClick={() => setOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full border border-edge-soft/60 bg-canvas/70 text-ink-subtle transition-colors hover:bg-elevated hover:text-ink 2xl:w-60 2xl:justify-start 2xl:px-4"
        >
          <Search size={17} className="shrink-0" />
          <span className="hidden flex-1 text-left text-[13px] 2xl:inline">Search movies, shows…</span>
          <kbd className="hidden rounded border border-edge-soft px-1 font-mono text-[10px] 2xl:inline">/</kbd>
        </button>
        <div className="hidden items-center gap-1 lg:flex xl:hidden">
          {secondaryNavigation.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.view}
                aria-label={entry.label}
                title={entry.label}
                onClick={() => setView(entry.view)}
                className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                  view === entry.view ? "bg-elevated text-ink" : "text-ink-muted hover:bg-elevated/70 hover:text-ink"
                }`}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </div>
        <div className="xl:hidden">
          <ProfileChip compact />
        </div>
        <div className="hidden sm:block">
          <WindowControls />
        </div>
      </div>
    </header>
  );
}
