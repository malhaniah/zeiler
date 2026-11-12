/**
 * Subtitle tracks, timing and appearance in separate views, so a long catalogue never
 * pushes the settings out of reach. Tracks can be searched and filtered by language and
 * source. Timing has direct-entry and stepped delay controls plus a second subtitle for
 * translation. Appearance changes apply at once and are saved for every video.
 * Keys: s next subtitle, c next second subtitle, z/x delay −/+0.1 s.
 */
import { AlertTriangle, Captions, Check, FileUp, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { playerSetProperty } from "../../lib/player-ipc";
import {
  backgroundOf,
  backgroundPatch,
  NO_STYLE,
  previewStyle,
  shadowOf,
  shadowPatch,
  SUBTITLE_FONTS,
  type Background,
  type Shadow,
} from "../../lib/subtitle-style";
import { ENCODINGS, languageName } from "../../lib/subtitles";
import type { SubtitleStyle } from "../../lib/types";
import { Choice, DelayControl, FilterChip, MenuTabs, PanelHeading, PopupMenu } from "./menu";
import type { MpvState } from "./mpv-state";
import type { SubtitleEntry, Tracks } from "./useTracks";

type SourceTab = "all" | "embedded" | "addons" | "files";
type Section = "tracks" | "timing" | "appearance";

const SOURCE_TABS: { id: SourceTab; label: string; has: (e: SubtitleEntry) => boolean }[] = [
  { id: "all", label: "All", has: () => true },
  { id: "embedded", label: "In the video", has: (e) => e.kind === "embedded" },
  { id: "addons", label: "Online", has: (e) => e.kind === "addon" || e.kind === "stream" },
  { id: "files", label: "Files", has: (e) => e.kind === "local" },
];

const SECTIONS: { id: Section; label: string }[] = [
  { id: "tracks", label: "Tracks" },
  { id: "timing", label: "Timing" },
  { id: "appearance", label: "Appearance" },
];

export function SubtitleMenu({ tracks, mpv }: { tracks: Tracks; mpv: MpvState }) {
  return (
    <PopupMenu
      label={
        <>
          <Captions size={15} />
          Subtitles
        </>
      }
      title="Subtitles (s next, c second, z/x delay)"
      width="w-[26rem]"
      panelClassName="flex flex-col overflow-hidden"
      onOpen={tracks.ensureListed}
    >
      {() => <SubtitlePanel tracks={tracks} mpv={mpv} />}
    </PopupMenu>
  );
}

function SubtitlePanel({ tracks, mpv }: { tracks: Tracks; mpv: MpvState }) {
  const [section, setSection] = useState<Section>("tracks");
  const [lang, setLang] = useState<string | null | "all">("all");
  const [sourceTab, setSourceTab] = useState<SourceTab>("all");
  const [search, setSearch] = useState("");
  const id = useId();
  const entries = tracks.subtitles;
  const selected = entries.find((e) => e.selected) ?? null;

  const languages = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const e of entries) counts.set(e.lang, (counts.get(e.lang) ?? 0) + 1);
    return [...counts.entries()];
  }, [entries]);
  const sourceTabs = SOURCE_TABS.filter((t) => t.id === "all" || entries.some(t.has));
  const activeSource = sourceTabs.find((t) => t.id === sourceTab) ?? SOURCE_TABS[0];
  const query = search.trim().toLocaleLowerCase();
  const shown = entries.filter((entry) => {
    if (lang !== "all" && entry.lang !== lang) return false;
    if (!activeSource.has(entry)) return false;
    if (!query) return true;
    return [entry.title, languageName(entry.lang), ...entry.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });

  return (
    <div className="flex h-[28rem] max-h-[inherit] flex-col">
      <div className="shrink-0">
        <PanelHeading
          aside={
            <button
              role="switch"
              aria-checked={tracks.enabled}
              onClick={tracks.enabled ? tracks.subtitlesOff : tracks.subtitlesOn}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold ${
                tracks.enabled ? "bg-accent/20 text-accent" : "bg-raised text-ink-muted hover:text-ink"
              }`}
            >
              {tracks.enabled ? "On" : "Off"}
            </button>
          }
        >
          Subtitles
        </PanelHeading>
        <MenuTabs id={id} label="Subtitle settings" tabs={SECTIONS} active={section} onChange={setSection} />
      </div>

      {section === "tracks" && (
        <TracksView
          id={id}
          tracks={tracks}
          entries={entries}
          shown={shown}
          selected={selected}
          languages={languages}
          lang={lang}
          setLang={setLang}
          sourceTabs={sourceTabs}
          activeSource={activeSource}
          setSourceTab={setSourceTab}
          search={search}
          setSearch={setSearch}
          clearFilters={() => {
            setSearch("");
            setLang("all");
            setSourceTab("all");
          }}
        />
      )}
      {section === "timing" && (
        <div
          id={`${id}-timing-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-timing-tab`}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3"
        >
          <DelayControl
            label="Subtitle delay"
            noun="subtitles"
            value={mpv.subDelay}
            onChange={(v) => void playerSetProperty("sub-delay", v).catch(() => undefined)}
            shortcut="z / x: −0.1 s / +0.1 s"
            description="Positive values show subtitles later; negative values show them earlier."
          />
          <SecondaryPicker
            tracks={tracks}
            secondarySid={mpv.secondarySid}
            onBrowse={() => setSection("tracks")}
          />
        </div>
      )}
      {section === "appearance" && (
        <AppearancePanel id={id} style={tracks.style} onChange={tracks.setStyle} />
      )}
    </div>
  );
}

function TracksView({
  id,
  tracks,
  entries,
  shown,
  selected,
  languages,
  lang,
  setLang,
  sourceTabs,
  activeSource,
  setSourceTab,
  search,
  setSearch,
  clearFilters,
}: {
  id: string;
  tracks: Tracks;
  entries: SubtitleEntry[];
  shown: SubtitleEntry[];
  selected: SubtitleEntry | null;
  languages: [string | null, number][];
  lang: string | null | "all";
  setLang: (lang: string | null | "all") => void;
  sourceTabs: typeof SOURCE_TABS;
  activeSource: (typeof SOURCE_TABS)[number];
  setSourceTab: (tab: SourceTab) => void;
  search: string;
  setSearch: (search: string) => void;
  clearFilters: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [lang, activeSource, search]);

  return (
    <div
      id={`${id}-tracks-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-tracks-tab`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 px-3 pb-2 pt-2">
        {entries.length > 4 && (
          <label className="relative mb-2 block">
            <span className="sr-only">Search subtitles</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a subtitle, language or addon…"
              className="h-9 w-full rounded-md border border-edge bg-canvas/60 pl-8 pr-8 text-xs text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
            />
            {search && (
              <button
                aria-label="Clear subtitle search"
                onClick={() => setSearch("")}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-ink-subtle hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </label>
        )}
        {languages.length > 1 && (
          <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Filter by language">
            <FilterChip active={lang === "all"} onClick={() => setLang("all")}>
              All <span className="text-ink-subtle">{entries.length}</span>
            </FilterChip>
            {languages.map(([code, count]) => (
              <FilterChip key={code ?? "unknown"} active={lang === code} onClick={() => setLang(code)}>
                {languageName(code)} <span className="text-ink-subtle">{count}</span>
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {sourceTabs.length > 2 && (
        <div className="flex shrink-0 gap-3 border-b border-edge-soft px-3 text-[11.5px]" role="tablist" aria-label="Subtitle source">
          {sourceTabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeSource.id}
              onClick={() => setSourceTab(tab.id)}
              className={`-mb-px border-b-2 pb-1.5 pt-0.5 ${
                tab.id === activeSource.id
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-subtle hover:text-ink-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="shrink-0 px-3 pb-1 pt-1.5 text-[10.5px] text-ink-subtle" aria-live="polite">
        {shown.length} of {entries.length} subtitles
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-0.5" role="listbox" aria-label="Subtitles">
        {shown.map((entry) => (
          <EntryRow key={entry.key} entry={entry} onPick={() => tracks.selectSubtitle(entry)} />
        ))}
        {tracks.listing === "loading" && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-subtle">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-edge border-t-accent" />
            Asking your subtitle addons…
          </div>
        )}
        {shown.length === 0 && tracks.listing !== "loading" && (
          <div className="px-3 py-4 text-center text-xs leading-relaxed text-ink-subtle">
            <p>{entries.length === 0 ? "No subtitles found. Add a subtitle addon, or load a file." : "No subtitles match these filters."}</p>
            {entries.length > 0 && (
              <button onClick={clearFilters} className="mt-2 rounded-md px-2 py-1 text-accent hover:bg-accent/10">
                Clear filters
              </button>
            )}
          </div>
        )}
        {tracks.listErrors.length > 0 && (
          <div className="px-3 pb-2 pt-1 text-[11px] leading-snug text-ink-subtle">
            {tracks.listErrors.join(" · ")}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge-soft px-3 py-2">
        <button
          onClick={tracks.pickLocal}
          className="flex h-8 items-center gap-1.5 rounded-md bg-raised/70 px-2.5 text-[11.5px] text-ink-muted hover:bg-elevated hover:text-ink"
        >
          <FileUp size={13} />
          Load from file…
        </button>
        {selected?.file && <EncodingPicker entry={selected} onPick={tracks.reencode} />}
      </div>
    </div>
  );
}

function EntryRow({ entry, onPick }: { entry: SubtitleEntry; onPick: () => void }) {
  const tags = entry.trackId !== null && entry.kind !== "embedded" ? ["Loaded", ...entry.tags] : entry.tags;
  return (
    <button
      role="option"
      aria-selected={entry.selected}
      onClick={onPick}
      disabled={entry.status === "loading"}
      className={`flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-elevated ${
        entry.selected ? "bg-accent/5 text-accent" : "text-ink-muted"
      }`}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {entry.status === "loading" ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-edge border-t-accent" />
        ) : entry.status === "error" ? (
          <AlertTriangle size={13} className="text-[oklch(0.75_0.12_25)]" />
        ) : entry.selected ? (
          <Check size={14} strokeWidth={2.5} />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className="truncate" title={entry.title}>{entry.title}</span>
          <span className="ml-auto max-w-[48%] shrink-0 truncate text-[10.5px] text-ink-subtle" title={tags.join(" · ")}>
            {tags.join(" · ")}
          </span>
        </span>
        {entry.error && (
          <span className="text-[11px] leading-snug text-[oklch(0.75_0.12_25)]">
            {entry.error} Click to try again.
          </span>
        )}
      </span>
    </button>
  );
}

function SecondaryPicker({
  tracks,
  secondarySid,
  onBrowse,
}: {
  tracks: Tracks;
  secondarySid: string;
  onBrowse: () => void;
}) {
  const current = tracks.secondaryChoices.find((e) => String(e.trackId) === secondarySid);
  return (
    <section aria-labelledby="second-subtitle-heading" className="border-t border-edge-soft pt-3">
      <h3 id="second-subtitle-heading" className="text-sm font-semibold text-ink">Second subtitle / translation</h3>
      <p className="mb-2 mt-1 text-[11px] leading-relaxed text-ink-subtle">
        Show another loaded subtitle above the main one. Load both in Tracks first; the main subtitle stays in place.
      </p>
      <select
        aria-label="Second subtitle or translation"
        value={current ? String(current.trackId) : ""}
        disabled={tracks.secondaryChoices.length === 0}
        onChange={(e) => {
          const picked = tracks.secondaryChoices.find((c) => String(c.trackId) === e.target.value);
          tracks.selectSecondary(picked ?? null);
        }}
        className="h-10 w-full rounded-md border border-edge bg-canvas px-2.5 text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="">None</option>
        {tracks.secondaryChoices.map((entry) => (
          <option key={entry.key} value={String(entry.trackId)}>
            {entry.title}
            {entry.lang && languageName(entry.lang) !== entry.title ? ` (${languageName(entry.lang)})` : ""}
          </option>
        ))}
      </select>
      {tracks.secondaryChoices.length === 0 && (
        <button onClick={onBrowse} className="mt-2 rounded-md px-1 py-1 text-[11px] text-accent hover:bg-accent/10">
          Browse subtitles to load another
        </button>
      )}
    </section>
  );
}

function AppearancePanel({
  id,
  style,
  onChange,
}: {
  id: string;
  style: SubtitleStyle | null;
  onChange: (patch: Partial<SubtitleStyle>) => void;
}) {
  if (!style) {
    return (
      <div id={`${id}-appearance-panel`} role="tabpanel" aria-labelledby={`${id}-appearance-tab`} className="flex flex-1 items-center justify-center text-xs text-ink-subtle">
        Loading appearance…
      </div>
    );
  }
  const customized = Object.values(style).some((value) => value !== null);
  return (
    <div
      id={`${id}-appearance-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-appearance-tab`}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Subtitle appearance</h3>
          <p className="mt-0.5 text-[10.5px] text-ink-subtle">Changes apply now and are saved for every video.</p>
        </div>
        <button
          onClick={() => onChange(NO_STYLE)}
          disabled={!customized}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-subtle hover:bg-elevated hover:text-ink disabled:opacity-40"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>
      <StylePreview style={style} />

      <div className="mt-3 flex flex-col gap-3">
        <StyleLine label="Text size">
          <Choice
            label="Subtitle text size"
            value={style.scale ?? 1}
            options={[
              { value: 0.8, label: "80%" },
              { value: 1, label: "100%" },
              { value: 1.25, label: "125%" },
              { value: 1.5, label: "150%" },
              { value: 1.8, label: "180%" },
            ]}
            onChange={(scale) => onChange({ scale })}
          />
        </StyleLine>
        <StyleLine label="Font">
          <select
            aria-label="Subtitle font"
            value={style.font ?? ""}
            onChange={(e) => onChange({ font: e.target.value || null })}
            className="h-9 w-full max-w-60 rounded-md border border-edge bg-canvas px-2.5 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">Player default</option>
            {SUBTITLE_FONTS.map((font) => (
              <option key={font} value={font}>{font}</option>
            ))}
          </select>
        </StyleLine>
        <StyleLine label="Text color">
          <ColorChoices label="Text" value={style.color} fallback="#FFFFFF" onChange={(color) => onChange({ color })} />
        </StyleLine>
        <StyleLine label="Outline">
          <Choice
            label="Subtitle outline"
            value={style.outlineSize}
            options={[
              { value: 0, label: "None" },
              { value: 1, label: "Thin" },
              { value: 2, label: "Medium" },
              { value: 3.5, label: "Thick" },
            ]}
            onChange={(outlineSize) => onChange({ outlineSize })}
          />
        </StyleLine>
        <StyleLine label="Outline color">
          <ColorChoices
            label="Outline"
            value={style.outlineColor}
            fallback="#000000"
            colors={[
              { value: "#000000", label: "Black" },
              { value: "#FFFFFF", label: "White" },
              { value: "#FFE14D", label: "Yellow" },
            ]}
            onChange={(outlineColor) => onChange({ outlineColor })}
          />
        </StyleLine>
        <StyleLine label="Background">
          <Choice<Background>
            label="Subtitle background"
            value={backgroundOf(style)}
            options={[
              { value: "default", label: "Default" },
              { value: "outline", label: "None" },
              { value: "box", label: "Box" },
            ]}
            onChange={(background) => onChange(backgroundPatch(background))}
          />
        </StyleLine>
        <StyleLine label="Shadow">
          <Choice<Shadow>
            label="Subtitle shadow"
            value={shadowOf(style)}
            options={[
              { value: "default", label: "Default" },
              { value: "none", label: "None" },
              { value: "soft", label: "Soft" },
              { value: "strong", label: "Strong" },
            ]}
            onChange={(shadow) => onChange(shadowPatch(shadow, style))}
          />
        </StyleLine>
        <StyleLine label="Position">
          <Choice
            label="Subtitle position"
            value={style.pos ?? 100}
            options={[
              { value: 100, label: "Bottom" },
              { value: 92, label: "Raised" },
              { value: 82, label: "Higher" },
            ]}
            onChange={(pos) => onChange({ pos })}
          />
        </StyleLine>
        <StyleLine label="Bold">
          <Choice<"off" | "on">
            label="Bold subtitles"
            value={style.bold === true ? "on" : "off"}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
            ]}
            onChange={(bold) => onChange({ bold: bold === "on" })}
          />
        </StyleLine>
      </div>

      <details className="mt-4 border-t border-edge-soft pt-2">
        <summary className="cursor-pointer rounded-md px-1 py-2 text-xs font-semibold text-ink-muted hover:text-ink">
          Alignment & styled subtitles
        </summary>
        <div className="flex flex-col gap-3 pb-1 pt-2">
          <StyleLine label="Alignment">
            <Choice<"left" | "center" | "right">
              label="Subtitle alignment"
              value={style.alignX ?? "center"}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
              onChange={(alignX) => onChange({ alignX })}
            />
          </StyleLine>
          <StyleLine label="Placement">
            <Choice<"top" | "center" | "bottom">
              label="Subtitle placement"
              value={style.alignY ?? "bottom"}
              options={[
                { value: "top", label: "Top" },
                { value: "center", label: "Middle" },
                { value: "bottom", label: "Bottom" },
              ]}
              onChange={(alignY) => onChange({ alignY })}
            />
          </StyleLine>
          <StyleLine label="Styled (ASS)">
            <Choice<"off" | "on">
              label="Use this appearance for styled ASS subtitles"
              value={style.assOverride === "force" ? "on" : "off"}
              options={[
                { value: "off", label: "Keep own look" },
                { value: "on", label: "Use my look" },
              ]}
              onChange={(override) => onChange({ assOverride: override === "on" ? "force" : null })}
            />
          </StyleLine>
          <p className="text-[10.5px] leading-relaxed text-ink-subtle">
            Replacing ASS styling can break positioned signs and karaoke. Text subtitles always use this appearance.
          </p>
        </div>
      </details>
    </div>
  );
}

function ColorChoices({
  label,
  value,
  fallback,
  colors = [
    { value: "#FFFFFF", label: "White" },
    { value: "#FFE14D", label: "Yellow" },
    { value: "#5FE3FF", label: "Cyan" },
  ],
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  colors?: { value: string; label: string }[];
  onChange: (color: string) => void;
}) {
  const custom = value !== null && !colors.some((color) => color.value === value.toUpperCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label} color`}>
      {colors.map((color) => {
        const active = value?.toUpperCase() === color.value;
        return (
          <button
            key={color.value}
            aria-pressed={active}
            onClick={() => onChange(color.value)}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] ${
              active ? "border-accent bg-accent/10 text-ink" : "border-edge-soft bg-raised/50 text-ink-muted hover:text-ink"
            }`}
          >
            <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: color.value }} />
            {color.label}
            {active && <Check size={11} />}
          </button>
        );
      })}
      <label className={`relative flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px] focus-within:outline focus-within:outline-2 focus-within:outline-accent ${
        custom ? "border-accent bg-accent/10 text-ink" : "border-edge-soft bg-raised/50 text-ink-muted hover:text-ink"
      }`}>
        <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: colorInputValue(value, fallback) }} />
        Custom
        {custom && <Check size={11} />}
        <input
          type="color"
          aria-label={`Custom ${label.toLowerCase()} color`}
          value={colorInputValue(value, fallback)}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function colorInputValue(value: string | null, fallback: string): string {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value;
  if (value && /^#[0-9a-f]{8}$/i.test(value)) return `#${value.slice(-6)}`;
  return fallback;
}

function StylePreview({ style }: { style: SubtitleStyle }) {
  const height = 112;
  return (
    <div
      aria-hidden
      className="relative flex items-end justify-center overflow-hidden rounded-lg border border-edge-soft"
      style={{
        height,
        background:
          "radial-gradient(circle at 30% 30%, oklch(0.55 0.08 60), transparent 55%), linear-gradient(160deg, oklch(0.42 0.06 230), oklch(0.2 0.03 260))",
      }}
    >
      <span className="absolute max-w-[90%] text-center leading-tight" style={previewStyle(style, 200)}>
        Where were you last night?
      </span>
    </div>
  );
}

function StyleLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="w-[5.5rem] shrink-0 text-xs text-ink-subtle">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function EncodingPicker({ entry, onPick }: { entry: SubtitleEntry; onPick: (label: string | null) => void }) {
  const current = ENCODINGS.find((e) => e.label.toLowerCase() === entry.encoding?.toLowerCase());
  return (
    <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-subtle" title="Garbled letters? Read the subtitle as another encoding.">
      <select
        aria-label="Subtitle encoding"
        value=""
        onChange={(e) => onPick(e.target.value === "auto" ? null : e.target.value)}
        className="h-8 max-w-48 rounded-md border border-edge bg-canvas px-1.5 text-[11.5px] text-ink outline-none focus:border-accent"
      >
        <option value="" disabled>
          Encoding: {current?.name ?? entry.encoding ?? "detected"}
        </option>
        <option value="auto">Detect again</option>
        {ENCODINGS.map((encoding) => (
          <option key={encoding.label} value={encoding.label}>{encoding.name}</option>
        ))}
      </select>
    </label>
  );
}
