/**
 * Other streams for the video playing, best first and grouped by quality. Search and
 * quality filters stay fixed while the catalogue scrolls independently. Picking a stream
 * resumes the video at its current position (useStreamSwitch.ts).
 */
import { Check, Layers, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/ui";
import { type StreamRowData, type StreamSection, streamBadges } from "../../lib/streams";
import type { Stream } from "../../lib/types";
import { FilterChip, PanelHeading, PopupMenu } from "./menu";
import { Spinner } from "./states";
import type { StreamSwitch } from "./useStreamSwitch";

type QualityFilter = StreamSection["quality"] | "all";

export function StreamsMenu({ streams }: { streams: StreamSwitch }) {
  return (
    <PopupMenu
      label={
        <>
          <Layers size={15} />
          Streams
        </>
      }
      title="Other streams for this video"
      width="w-[28rem]"
      panelClassName="flex flex-col overflow-hidden"
      onOpen={streams.ensureListed}
    >
      {(close) => <StreamsPanel streams={streams} close={close} />}
    </PopupMenu>
  );
}

function StreamsPanel({ streams, close }: { streams: StreamSwitch; close: () => void }) {
  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState<QualityFilter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const total = useMemo(
    () => streams.sections.reduce((count, section) => count + section.rows.length, 0),
    [streams.sections],
  );
  const activeQuality = streams.sections.some((section) => section.quality === quality) ? quality : "all";
  const query = search.trim().toLocaleLowerCase();
  const shownSections = streams.sections.flatMap((section) => {
    if (activeQuality !== "all" && section.quality !== activeQuality) return [];
    const rows = section.rows.filter((row) => {
      if (!query) return true;
      const badges = streamBadges(row.stream, { compact: true }).map((badge) => badge.label);
      return [row.addonName, releaseLine(row.stream) ?? "", ...badges]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
  const shown = shownSections.reduce((count, section) => count + section.rows.length, 0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [activeQuality, search]);

  return (
    <div className="flex h-[28rem] max-h-[inherit] flex-col">
      <div className="shrink-0">
        <PanelHeading aside={<span className="text-[10.5px] text-ink-subtle">{total} available</span>}>
          Streams
        </PanelHeading>
        {total > 4 && (
          <div className="relative mx-3 mb-2">
            <span className="sr-only">Search streams</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an addon, release or source…"
              className="h-9 w-full rounded-md border border-edge bg-canvas/60 pl-8 pr-8 text-xs text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
            />
            {search && (
              <button
                aria-label="Clear stream search"
                onClick={() => setSearch("")}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-ink-subtle hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {streams.sections.length > 1 && (
          <div className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2" role="group" aria-label="Filter by stream quality">
            <FilterChip active={activeQuality === "all"} onClick={() => setQuality("all")}>
              All <span className="text-ink-subtle">{total}</span>
            </FilterChip>
            {streams.sections.map((section) => (
              <FilterChip key={section.quality} active={activeQuality === section.quality} onClick={() => setQuality(section.quality)}>
                {section.label} <span className="text-ink-subtle">{section.rows.length}</span>
              </FilterChip>
            ))}
          </div>
        )}
        {total > 0 && (
          <div className="border-t border-edge-soft px-3 pb-1 pt-1.5 text-[10.5px] text-ink-subtle" aria-live="polite">
            {shown} of {total} streams
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
        {streams.listing === "loading" && (
          <div role="status" className="flex items-center gap-3 px-3 py-3 text-xs text-ink-muted">
            <Spinner />
            Asking your addons…
          </div>
        )}
        {streams.listing === "error" && (
          <div role="alert" className="px-3 py-5 text-center text-xs text-ink-subtle">
            <p>Could not load this video&apos;s streams.</p>
            <button onClick={streams.ensureListed} className="mt-2 rounded-md px-2 py-1 text-accent hover:bg-accent/10">
              Try again
            </button>
          </div>
        )}
        {streams.listing === "done" && total === 0 && (
          <div role="status" className="px-3 py-3 text-xs text-ink-subtle">
            No stream that plays here for this video.
          </div>
        )}
        {total > 0 && shown === 0 && (
          <div className="px-3 py-5 text-center text-xs text-ink-subtle">
            <p>No streams match these filters.</p>
            <button
              onClick={() => {
                setSearch("");
                setQuality("all");
              }}
              className="mt-2 rounded-md px-2 py-1 text-accent hover:bg-accent/10"
            >
              Clear filters
            </button>
          </div>
        )}
        {shownSections.map((section) => (
          <section key={section.quality} aria-label={`${section.label} streams`}>
            <div className="sticky top-0 z-10 bg-surface">
              <PanelHeading aside={<span className="text-[10.5px] text-ink-subtle">{section.rows.length}</span>}>
                {section.label}
              </PanelHeading>
            </div>
            <div className="flex flex-col" role="listbox" aria-label={`${section.label} streams`}>
              {section.rows.map((row) => (
                <StreamOption
                  key={row.key}
                  row={row}
                  playing={row.key === streams.current}
                  onPick={() => {
                    if (row.key === streams.current) return;
                    close();
                    streams.pick(row);
                  }}
                />
              ))}
            </div>
          </section>
        ))}
        {(streams.hidden > 0 || streams.errors.length > 0) && streams.listing !== "error" && (
          <div className="mx-3 mt-2 flex flex-col gap-1 border-t border-edge-soft pt-2 text-[10.5px] leading-relaxed text-ink-subtle">
            {streams.hidden > 0 && (
              <span>
                {streams.hidden} {streams.hidden === 1 ? "stream" : "streams"} for other episodes left out.
              </span>
            )}
            {streams.errors.map((error, i) => (
              <span key={`${i}-${error}`} className="text-[oklch(0.75_0.12_25)]" title={error}>
                {error}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The release a stream is (the description's first line), else its name's lines. */
function releaseLine(stream: Stream): string | null {
  const first = stream.description
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (first) return first;
  const name = stream.name?.split("\n").map((line) => line.trim()).filter(Boolean).join(" · ");
  return name || null;
}

function StreamOption({ row, playing, onPick }: { row: StreamRowData; playing: boolean; onPick: () => void }) {
  const { stream, addonName } = row;
  const release = releaseLine(stream);
  const badges = streamBadges(stream, { compact: true });
  return (
    <button
      role="option"
      aria-selected={playing}
      aria-disabled={playing}
      onClick={onPick}
      className={`flex min-h-12 w-full items-start gap-2 px-3 py-2 text-left ${
        playing ? "cursor-default bg-accent/5 text-accent" : "text-ink-muted hover:bg-elevated"
      }`}
      title={release ?? addonName}
    >
      <span className="flex w-4 shrink-0 pt-0.5 text-sm">{playing && <Check size={14} strokeWidth={2.5} />}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-2 text-sm">
          <span className={`shrink-0 font-medium ${playing ? "text-accent" : "text-ink"}`}>{addonName}</span>
          {release && <span className="truncate text-[11.5px] text-ink-subtle">{release}</span>}
        </span>
        {(badges.length > 0 || playing) && (
          <span className="flex flex-wrap items-center gap-1">
            {playing && <Badge tone="accent">Playing</Badge>}
            {badges.map((badge) => (
              <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
