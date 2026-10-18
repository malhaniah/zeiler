/**
 * The Streams menu: the other streams for the video playing, in the picker's sections
 * by quality and with its badges (compact), best first; the one playing is marked.
 * Picking one plays it from where this one is (useStreamSwitch.ts).
 */
import { Layers } from "lucide-react";
import { Badge } from "../../components/ui";
import { type StreamRowData, streamBadges } from "../../lib/streams";
import type { Stream } from "../../lib/types";
import { PanelHeading, PopupMenu } from "./menu";
import { Spinner } from "./states";
import type { StreamSwitch } from "./useStreamSwitch";

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
      onOpen={streams.ensureListed}
    >
      {(close) => (
        <div className="flex flex-col pb-1">
          {streams.listing === "loading" && (
            <div role="status" className="flex items-center gap-3 px-3 py-3 text-xs text-ink-muted">
              <Spinner />
              Asking your addons…
            </div>
          )}
          {streams.listing === "done" && streams.sections.length === 0 && (
            <div role="status" className="px-3 py-3 text-xs text-ink-subtle">
              No stream that plays here for this video.
            </div>
          )}
          {streams.sections.map((section) => (
            <div key={section.quality} className="flex flex-col">
              <PanelHeading aside={<span className="text-[10.5px] text-ink-subtle">{section.rows.length}</span>}>
                {section.label}
              </PanelHeading>
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
            </div>
          ))}
          {(streams.hidden > 0 || streams.errors.length > 0) && (
            <div className="mt-1 flex flex-col gap-0.5 border-t border-edge-soft px-3 pt-1.5 text-[10.5px] text-ink-subtle">
              {streams.hidden > 0 && (
                <span>
                  {streams.hidden} {streams.hidden === 1 ? "stream" : "streams"} for other episodes
                  left out.
                </span>
              )}
              {streams.errors.map((error, i) => (
                <span key={`${i}-${error}`} className="truncate text-[oklch(0.75_0.12_25)]" title={error}>
                  {error}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </PopupMenu>
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
      // still focusable, so a keyboard reaches the stream playing; a pick of it does nothing
      aria-disabled={playing}
      onClick={onPick}
      className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${
        playing ? "cursor-default text-accent" : "text-ink-muted hover:bg-elevated"
      }`}
      title={release ?? addonName}
    >
      <span className="w-4 shrink-0 pt-px text-sm">{playing ? "✓" : ""}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2 text-sm">
          <span className={`shrink-0 font-medium ${playing ? "text-accent" : "text-ink"}`}>{addonName}</span>
          {release && <span className="truncate text-[11.5px] text-ink-subtle">{release}</span>}
        </span>
        {(badges.length > 0 || playing) && (
          <span className="flex flex-wrap items-center gap-1">
            {playing && <Badge tone="accent">Playing</Badge>}
            {badges.map((badge) => (
              <Badge key={badge.label} tone={badge.tone}>
                {badge.label}
              </Badge>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
