import zeilerLogo from "../assets/zeiler-logo-white.png";
import { useSettings } from "../lib/store";
import { type RootView, useView } from "../lib/view";
import { ProfileChip } from "../views/profiles/ProfileChip";
import { type NavEntry, primaryNavigation, secondaryNavigation } from "./navigation";

export function Sidebar() {
  const { view, setView } = useView();
  const { settings } = useSettings();
  const primary = primaryNavigation(settings?.hideAnime, settings?.hideLiveTv);

  return (
    <aside className="relative z-[60] hidden w-60 shrink-0 flex-col border-r border-edge-soft bg-canvas xl:flex">
      <button
        data-tauri-drag-region
        onClick={() => setView("home")}
        className="flex h-20 shrink-0 items-center gap-2 px-6 text-left text-ink"
      >
        <img src={zeilerLogo} alt="" className="pointer-events-none h-11 w-11 shrink-0 select-none" />
        <span className="pointer-events-none font-brand text-[30px] font-medium tracking-tight">
          Zeiler
        </span>
      </button>

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6 pt-3">
        <nav aria-label="Main navigation" className="flex flex-col gap-1.5">
          {primary.map((entry) => (
            <NavItem key={entry.view} entry={entry} active={view === entry.view} onSelect={setView} />
          ))}
        </nav>
        <div data-tauri-drag-region className="py-2.5">
          <div className="mx-3 h-px bg-gradient-to-r from-transparent via-edge-soft/55 to-transparent" />
        </div>
        <nav aria-label="Library and settings" className="flex flex-col gap-1.5">
          {secondaryNavigation.map((entry) => (
            <NavItem key={entry.view} entry={entry} active={view === entry.view} onSelect={setView} />
          ))}
        </nav>
        <div data-tauri-drag-region className="min-h-8" />
      </div>

      <ProfileChip />
      <div className="px-6 pb-5 text-[11px] leading-relaxed text-ink-subtle/70">
        Zeiler hosts no media, indexes no media, and ships no content addon.
      </div>
    </aside>
  );
}

function NavItem({ entry, active, onSelect }: { entry: NavEntry; active: boolean; onSelect: (view: RootView) => void }) {
  const Icon = entry.icon;
  return (
    <button
      aria-current={active ? "page" : undefined}
      title={entry.label}
      onClick={() => onSelect(entry.view)}
      className={`relative flex h-14 items-center justify-start gap-4 rounded-xl px-4 text-[15px] transition-colors duration-150 ${
        active ? "bg-elevated text-accent" : "text-ink-muted hover:bg-elevated/50 hover:text-ink"
      }`}
    >
      <Icon size={20} strokeWidth={active ? 2.1 : 1.7} />
      <span className="flex-1 text-left">{entry.label}</span>
    </button>
  );
}
