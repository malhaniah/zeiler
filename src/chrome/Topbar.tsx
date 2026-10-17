import { ArrowLeft, Search } from "lucide-react";
import { useEffect } from "react";
import { playerActive } from "../lib/playback-handoff";
import { useSearch } from "../lib/store";
import { useView } from "../lib/view";
import { WindowControls } from "./WindowControls";

export function Topbar() {
  const { canGoBack, goBack, top } = useView();
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
    <header className="fixed left-0 right-0 top-0 z-[55] h-20">
      <div
        data-tauri-drag-region
        className="relative z-10 grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-8"
      >
        <div className="flex items-center pl-[72px] lg:pl-[244px]" data-tauri-drag-region>
          {canGoBack && (
            <button
              onClick={goBack}
              className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-edge-soft/60 bg-canvas/85 pl-3 pr-5 text-[13.5px] font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          )}
        </div>

        <button
          onClick={() => setOpen(true)}
          className="flex h-11 w-[14rem] items-center gap-3 rounded-full border border-edge-soft/60 bg-elevated/80 px-5 text-left opacity-80 transition-[width,opacity,background-color] duration-200 hover:bg-elevated hover:opacity-100 sm:w-[20rem] sm:hover:w-[24rem] lg:w-[24rem] lg:hover:w-[28rem] xl:w-[28rem] xl:hover:w-[34rem]"
        >
          <Search size={16} className="shrink-0 text-ink-subtle" />
          <span className="flex-1 truncate text-[14px] text-ink-subtle">
            Search movies, shows…
          </span>
          <kbd className="hidden shrink-0 rounded-md border border-edge-soft bg-canvas/50 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-subtle sm:inline">
            /
          </kbd>
        </button>

        <div className="flex items-center justify-end gap-1.5">
          <WindowControls />
        </div>
      </div>
    </header>
  );
}
