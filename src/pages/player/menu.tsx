/**
 * The control bar's popup menus: a chip button with a panel above it, and the rows and
 * small controls the panels are built from (ControlsBar, SubtitleMenu, AudioMenu).
 */
import { RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const chip =
  "flex h-10 shrink-0 items-center gap-0 rounded-md bg-canvas/50 px-2 text-[0px] text-ink-muted transition-[background-color,color,transform] duration-150 hover:bg-elevated hover:text-ink active:scale-95 sm:gap-1.5 sm:px-3 sm:text-sm";

/** Marks an open menu panel: the mouse wheel then scrolls it rather than set the volume
 * (`usePlayerWheel`). */
export const PLAYER_MENU_ATTR = "data-player-menu";

/** A button with a viewport-positioned panel above it; closes on a click elsewhere or
 * Escape (which then does not also leave the player), and on a pick unless the panel
 * keeps itself open. */
export function PopupMenu({
  label,
  title,
  width = "w-56",
  panelClassName,
  onOpen,
  children,
}: {
  label: ReactNode;
  title?: string;
  /** a Tailwind width class for the panel */
  width?: string;
  /** replaces the panel's usual scrolling (for a panel with its own scroll regions) */
  panelClassName?: string;
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ bottom: 0, right: 12, maxHeight: 480 });
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = panelRef.current?.offsetWidth ?? 0;
      const maxHeight = Math.max(120, Math.min(480, window.innerHeight * 0.7, rect.top - 16));
      const furthestRight = Math.max(12, window.innerWidth - panelWidth - 12);
      const furthestBottom = Math.max(12, window.innerHeight - maxHeight - 12);
      setPosition({
        bottom: Math.min(furthestBottom, Math.max(12, window.innerHeight - rect.top + 8)),
        right: Math.min(furthestRight, Math.max(12, window.innerWidth - rect.right)),
        maxHeight,
      });
    };
    updatePosition();
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>("button:not(:disabled), select, input");
      (first ?? panel)?.focus();
    });
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    // capture phase: runs before the player's window shortcuts, which skip a
    // prevented event
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) updatePosition();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        className={chip}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        title={title}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={title ?? "Player menu"}
            tabIndex={-1}
            data-player-menu="" // PLAYER_MENU_ATTR: the wheel scrolls it, not the volume
            className={`animate-player-menu-in fixed z-[120] max-w-[calc(100vw-1.5rem)] rounded-xl border border-edge bg-surface py-1 shadow-2xl ${panelClassName ?? "overflow-y-auto"} ${width}`}
            style={position}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuRow({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-elevated ${
        selected ? "text-accent" : "text-ink-muted"
      }`}
      onClick={onPick}
    >
      {selected ? "✓ " : ""}
      {label}
    </button>
  );
}

/** A small heading inside a panel. */
export function PanelHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {children}
      </span>
      {aside}
    </div>
  );
}

/** Small toggle chips: one of `options` is current. */
export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${
            option.value === value
              ? "bg-ink text-canvas"
              : "bg-raised/70 text-ink-muted hover:bg-elevated hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Keyboard-accessible tabs for a player panel with its own scroll regions. */
export function MenuTabs<T extends string>({
  id,
  label,
  tabs,
  active,
  onChange,
}: {
  id: string;
  label: string;
  tabs: readonly { id: T; label: string }[];
  active: T;
  onChange: (tab: T) => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent, current: T) => {
    const index = tabs.findIndex((tab) => tab.id === current);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next].id;
    onChange(tab);
    requestAnimationFrame(() => document.getElementById(`${id}-${tab}-tab`)?.focus());
  };
  return (
    <div className="flex border-b border-edge-soft px-3" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${id}-${tab.id}-tab`}
          role="tab"
          aria-selected={tab.id === active}
          aria-controls={`${id}-${tab.id}-panel`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => onKeyDown(e, tab.id)}
          className={`-mb-px h-9 flex-1 border-b-2 text-xs font-semibold transition-colors ${
            tab.id === active
              ? "border-accent text-ink"
              : "border-transparent text-ink-subtle hover:text-ink"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[11px] ${
        active ? "bg-ink text-canvas" : "bg-raised/70 text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** "+0.3 s", "−1.25 s", "0.0 s". */
export function formatDelay(seconds: number): string {
  const rounded = Math.round(seconds * 100) / 100;
  if (rounded === 0) return "0.0 s";
  const tenths = Number.isInteger(Math.round(Math.abs(rounded) * 100) / 10);
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(tenths ? 1 : 2)} s`;
}

/** A precise delay with immediate local feedback, native range input and direct entry. */
export function DelayControl({
  label,
  noun,
  value,
  onChange,
  shortcut,
  description,
}: {
  label: string;
  /** used in button names: "subtitles" or "audio" */
  noun: string;
  value: number;
  onChange: (seconds: number) => void;
  shortcut?: string;
  description: string;
}) {
  const id = useId();
  const [current, setCurrent] = useState(value);
  const currentRef = useRef(value);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    currentRef.current = value;
    setCurrent(value);
  }, [value]);

  const commit = (next: number) => {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(600, Math.max(-600, Math.round(next * 1000) / 1000));
    currentRef.current = clamped;
    setCurrent(clamped);
    onChange(clamped);
  };
  const commitDraft = () => {
    if (draft?.trim()) commit(Number(draft));
    setDraft(null);
  };
  const step = (delta: number) => commit(currentRef.current + delta);
  const stepButton = (delta: number) => (
    <button
      type="button"
      onClick={() => step(delta)}
      className="h-10 rounded-md bg-raised/70 font-mono text-xs text-ink-muted transition-colors hover:bg-elevated hover:text-ink active:bg-raised"
      aria-label={`${delta > 0 ? "Delay" : "Advance"} ${noun} by ${Math.abs(delta)} seconds`}
    >
      {delta > 0 ? "+" : "−"}{Math.abs(delta)}
    </button>
  );

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id={`${id}-heading`} className="text-sm font-semibold text-ink">{label}</h3>
        {shortcut && <span className="text-[10.5px] text-ink-subtle">{shortcut}</span>}
      </div>
      <div className="rounded-lg border border-edge-soft bg-canvas/30 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">Exact value</span>
          <label className="flex h-9 items-center rounded-md border border-edge bg-canvas px-2.5 focus-within:border-accent">
            <input
              type="number"
              aria-label={`${label} in seconds`}
              min={-600}
              max={600}
              step={0.1}
              value={draft ?? String(Math.round(current * 1000) / 1000)}
              onFocus={(e) => {
                setDraft(String(Math.round(current * 1000) / 1000));
                e.currentTarget.select();
              }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-20 bg-transparent text-right font-mono text-sm tabular-nums text-ink outline-none"
            />
            <span className="ml-1.5 text-xs text-ink-subtle">s</span>
          </label>
        </div>
        <input
          type="range"
          aria-label={`Adjust ${label.toLowerCase()} from minus ten to ten seconds`}
          aria-valuetext={formatDelay(current)}
          min={-10}
          max={10}
          step={0.05}
          value={Math.min(10, Math.max(-10, current))}
          onInput={(e) => commit(Number(e.currentTarget.value))}
          className="h-8 w-full cursor-pointer accent-(--color-accent)"
        />
        <div className="flex items-center justify-between text-[10.5px] text-ink-subtle">
          <span>Earlier</span>
          <output className="font-mono text-sm tabular-nums text-ink">{formatDelay(current)}</output>
          <span>Later</span>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {stepButton(-0.5)}
          {stepButton(-0.1)}
          <button
            type="button"
            onClick={() => commit(0)}
            disabled={Math.abs(current) < 1e-6}
            className="flex h-10 items-center justify-center gap-1 rounded-md px-1 text-[11px] text-ink-subtle hover:bg-elevated hover:text-ink disabled:opacity-40"
          >
            <RotateCcw size={12} />
            Reset
          </button>
          {stepButton(0.1)}
          {stepButton(0.5)}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        {description} The slider covers ±10 s; exact entry covers ±600 s.
      </p>
    </section>
  );
}
