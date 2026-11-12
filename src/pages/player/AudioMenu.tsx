/**
 * Audio tracks in one view and playback adjustments in another, so a long track list
 * never hides delay or normalization. Track choices are remembered for the title;
 * normalization is saved for every video.
 */
import { AudioLines, Check, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { playerSetProperty } from "../../lib/player-ipc";
import { languageName } from "../../lib/subtitles";
import { Choice, DelayControl, FilterChip, MenuTabs, PanelHeading, PopupMenu } from "./menu";
import type { MpvState } from "./mpv-state";
import type { AudioEntry, Tracks } from "./useTracks";

type Section = "tracks" | "playback";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "tracks", label: "Tracks" },
  { id: "playback", label: "Playback" },
];

export function AudioMenu({ tracks, mpv }: { tracks: Tracks; mpv: MpvState }) {
  return (
    <PopupMenu
      label={
        <>
          <AudioLines size={15} />
          Audio
        </>
      }
      title="Audio"
      width="w-[24rem]"
      panelClassName="flex flex-col overflow-hidden"
    >
      {() => <AudioPanel tracks={tracks} mpv={mpv} />}
    </PopupMenu>
  );
}

function AudioPanel({ tracks, mpv }: { tracks: Tracks; mpv: MpvState }) {
  const [section, setSection] = useState<Section>("tracks");
  const [lang, setLang] = useState<string | null | "all">("all");
  const [search, setSearch] = useState("");
  const id = useId();
  const entries = tracks.audio;
  const selected = entries.find((entry) => entry.selected) ?? null;
  const languages = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const entry of entries) counts.set(entry.lang, (counts.get(entry.lang) ?? 0) + 1);
    return [...counts.entries()];
  }, [entries]);
  const query = search.trim().toLocaleLowerCase();
  const shown = entries.filter((entry) => {
    if (lang !== "all" && entry.lang !== lang) return false;
    if (!query) return true;
    return [entry.title, languageName(entry.lang), ...entry.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });

  return (
    <div className="flex h-[22rem] max-h-[inherit] flex-col">
      <div className="shrink-0">
        <PanelHeading aside={<span className="max-w-40 truncate text-[10.5px] text-ink-subtle">{selected?.title ?? "No track selected"}</span>}>
          Audio
        </PanelHeading>
        <MenuTabs id={id} label="Audio settings" tabs={SECTIONS} active={section} onChange={setSection} />
      </div>

      {section === "tracks" && (
        <AudioTracks
          id={id}
          entries={entries}
          shown={shown}
          languages={languages}
          lang={lang}
          setLang={setLang}
          search={search}
          setSearch={setSearch}
          onPick={tracks.selectAudio}
          clearFilters={() => {
            setLang("all");
            setSearch("");
          }}
        />
      )}
      {section === "playback" && (
        <div
          id={`${id}-playback-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-playback-tab`}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3"
        >
          <DelayControl
            label="Audio delay"
            noun="audio"
            value={mpv.audioDelay}
            onChange={(v) => void playerSetProperty("audio-delay", v).catch(() => undefined)}
            description="Positive values play the sound later; negative values play it earlier."
          />
          {tracks.normalize !== null && (
            <section aria-labelledby="audio-normalize-heading" className="border-t border-edge-soft pt-3">
              <h3 id="audio-normalize-heading" className="text-sm font-semibold text-ink">Volume normalization</h3>
              <p className="mb-2 mt-1 text-[11px] leading-relaxed text-ink-subtle">
                Quiet dialogue louder and loud scenes quieter. Saved for every video; takes effect from the next video.
              </p>
              <Choice
                label="Normalize volume"
                value={tracks.normalize ? "on" : "off"}
                options={[
                  { value: "off", label: "Off" },
                  { value: "on", label: "On" },
                ]}
                onChange={(value) => tracks.setNormalize(value === "on")}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function AudioTracks({
  id,
  entries,
  shown,
  languages,
  lang,
  setLang,
  search,
  setSearch,
  onPick,
  clearFilters,
}: {
  id: string;
  entries: AudioEntry[];
  shown: AudioEntry[];
  languages: [string | null, number][];
  lang: string | null | "all";
  setLang: (lang: string | null | "all") => void;
  search: string;
  setSearch: (search: string) => void;
  onPick: (entry: AudioEntry) => void;
  clearFilters: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [lang, search]);

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
            <span className="sr-only">Search audio tracks</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a language, track or codec…"
              className="h-9 w-full rounded-md border border-edge bg-canvas/60 pl-8 pr-8 text-xs text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
            />
            {search && (
              <button
                aria-label="Clear audio search"
                onClick={() => setSearch("")}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-ink-subtle hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </label>
        )}
        {languages.length > 1 && (
          <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Filter audio by language">
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
      {entries.length > 0 && (
        <div className="shrink-0 border-t border-edge-soft px-3 pb-1 pt-1.5 text-[10.5px] text-ink-subtle" aria-live="polite">
          {shown.length} of {entries.length} audio tracks
        </div>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-0.5" role="listbox" aria-label="Audio tracks">
        {shown.map((entry) => (
          <AudioTrackRow key={entry.id} entry={entry} onPick={() => onPick(entry)} />
        ))}
        {entries.length === 0 && <div className="px-3 py-3 text-xs text-ink-subtle">No audio tracks</div>}
        {entries.length > 0 && shown.length === 0 && (
          <div className="px-3 py-5 text-center text-xs text-ink-subtle">
            <p>No audio tracks match these filters.</p>
            <button onClick={clearFilters} className="mt-2 rounded-md px-2 py-1 text-accent hover:bg-accent/10">
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AudioTrackRow({ entry, onPick }: { entry: AudioEntry; onPick: () => void }) {
  return (
    <button
      role="option"
      aria-selected={entry.selected}
      onClick={onPick}
      className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated ${
        entry.selected ? "bg-accent/5 text-accent" : "text-ink-muted"
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {entry.selected && <Check size={14} strokeWidth={2.5} />}
      </span>
      <span className="truncate" title={entry.title}>{entry.title}</span>
      <span className="ml-auto max-w-[48%] shrink-0 truncate text-[10.5px] text-ink-subtle" title={entry.tags.join(" · ")}>
        {entry.tags.join(" · ")}
      </span>
    </button>
  );
}
