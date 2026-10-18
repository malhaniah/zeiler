import { ChevronDown, ChevronLeft, ExternalLink, ListVideo, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WindowControls } from "../chrome/WindowControls";
import { AddonLogo } from "../components/cards";
import { fallbackGradient } from "../components/Poster";
import { Badge, EmptyState, Modal } from "../components/ui";
import { errorMessage, PICKER_MAX_AGE_SECS, streamsGet } from "../lib/ipc";
import { formatClock, useLibraryItem } from "../lib/library";
import type { ResumePoint, VideoRef } from "../lib/library-ipc";
import {
  type PlayerLaunch,
  launchFailedBefore,
  launchForStream,
  openPlayer,
  playerActive,
  subscribeLaunchFailures,
} from "../lib/playback-handoff";
import { useSearch, useSettings } from "../lib/store";
import {
  bestRow,
  episodeTarget,
  hiddenCount,
  playable,
  streamBadges,
  type StreamRowData as Row,
  streamRows,
  streamSections,
} from "../lib/streams";
import { useView } from "../lib/view";
import type { AddonStreams, MetaItem, Video } from "../lib/types";

/** Only streams that leave the app (YouTube, external links) can fail here; everything
 * else plays on the Player screen, which reports failures back (`subscribeLaunchFailures`).
 * `resume` asks where to start a launch whose video has a resume point. */
type Phase =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "resume"; launch: PlayerLaunch; rowKey: string; resume: ResumePoint };

const NO_VIDEOS: VideoRef[] = [];

/**
 * The stream picker. With auto-play (`autoPlayStream`, on by default; not for live TV,
 * and not when the user asked to choose: `choose`) it shows "Finding the best stream",
 * then starts the best matching stream as soon as the addons answered (`bestRow`;
 * the resume prompt first, if the video has a resume point) and leaves the view stack
 * as if it had never been there, so Back from the Player returns to the screen that
 * asked to play. When nothing matches, or the user asks for the list, it is the picker
 * as before. Auto-play waits for the library (a resume point), passes over a stream
 * that failed before (`launchFailedBefore`), and gives way to the list when another
 * screen or the search came over the picker meanwhile.
 */
export function PlayPickerView({
  meta,
  video,
  choose = false,
}: {
  meta: MetaItem;
  video: Video | null;
  choose?: boolean;
}) {
  const { goBack, top } = useView();
  const { settings } = useSettings();
  const { open: searching } = useSearch();
  // this picker is the screen on top (the search or another frame may come over it)
  const onTop = top.kind === "picker" && top.meta === meta && top.video === video && !searching;
  const onTopRef = useRef(onTop);
  onTopRef.current = onTop;
  const live = meta.behaviorHints.isLive || meta.type === "tv";
  const videoId = live
    ? (meta.behaviorHints.defaultVideoId ?? meta.id)
    : (video?.id ?? meta.behaviorHints.defaultVideoId ?? meta.id);

  const [groups, setGroups] = useState<AddonStreams[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null); // transportUrl or null = all
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [failed, setFailed] = useState<Set<string>>(new Set());
  // where the library says this video stopped (live TV is never tracked)
  const { detail, loaded: libraryLoaded } = useLibraryItem(live ? null : meta.id, NO_VIDEOS);
  const resume =
    detail?.entry.resume && detail.entry.resume.videoId === videoId ? detail.entry.resume : null;

  // auto-play: undecided until the settings and the addons' answer are in, then
  // started (the frame goes) or off (the list shows)
  const [auto, setAuto] = useState<"deciding" | "started" | "off">(() =>
    choose || live || settings?.autoPlayStream === false ? "off" : "deciding",
  );
  // nothing matched: the list says why no stream started
  const [autoMissed, setAutoMissed] = useState(false);
  // (read by `start`, which may run before the "started" render)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (auto === "deciding" && settings && !settings.autoPlayStream) setAuto("off");
  }, [auto, settings]);

  // the episode asked for: Rust leaves out the streams for any other (not for live TV)
  const target = useMemo(() => (live ? null : episodeTarget(meta, video)), [live, meta, video]);
  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    setFailed(new Set());
    streamsGet(meta.type, videoId, target, PICKER_MAX_AGE_SECS).then((g) => !cancelled && setGroups(g));
    return () => {
      cancelled = true;
    };
  }, [meta.type, videoId, target]);

  // Launch id -> row key for streams this picker opened in the Player, so a failure
  // reported there marks the row here too (this view stays mounted under the player).
  const opened = useRef(new Map<string, string>());
  useEffect(() => {
    opened.current.clear();
    return subscribeLaunchFailures((id) => {
      const key = opened.current.get(id);
      if (key !== undefined) setFailed((prev) => new Set(prev).add(key));
    });
  }, [meta.type, videoId]);

  // the meta's own streams, then every addon's best first, in sections by quality
  const rows = useMemo(() => {
    const all = streamRows(groups, video);
    return filter ? all.filter((r) => r.transportUrl === filter) : all;
  }, [groups, video, filter]);
  const sections = useMemo(() => streamSections(rows), [rows]);
  // rows whose stream failed before (maybe started by an auto-play picker gone since)
  const failedBefore = useMemo(
    () =>
      new Set(
        rows
          .filter((r) => {
            const launch = launchFor(r);
            return launch !== null && launchFailedBefore(launch);
          })
          .map((r) => r.key),
      ),
    // (launchFor reads meta and video, which make the rows)
    [rows],
  );
  const isFailed = (row: Row) => failed.has(row.key) || failedBefore.has(row.key);
  const best = bestRow(rows, (r) => !isFailed(r))?.key ?? null;
  // (of the addon the list is filtered to)
  const hidden = hiddenCount(filter ? (groups ?? []).filter((g) => g.transportUrl === filter) : groups);

  // auto-play: the best matching stream, once the addons and the library answered
  useEffect(() => {
    if (auto !== "deciding" || !settings?.autoPlayStream || groups === null) return;
    if (!libraryLoaded) return;
    // another screen came over the picker meanwhile: the list, not a sudden player
    if (!onTop) {
      setAuto("off");
      return;
    }
    const row = bestRow(streamRows(groups, video), (r) => {
      const launch = launchFor(r);
      return launch !== null && !launchFailedBefore(launch);
    });
    if (!row) {
      setAuto("off");
      setAutoMissed(true);
      return;
    }
    setAuto("started");
    autoStarted.current = true;
    // (play and launchFor read only this render's props and state)
    void play(row);
  }, [auto, settings, groups, video, libraryLoaded, onTop]);

  const settled = groups !== null;
  const addonOptions = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    if (video && video.streams.length > 0) {
      seen.set("embedded", { name: "Embedded", count: video.streams.length });
    }
    for (const group of groups ?? []) {
      if (group.streams.length > 0 || group.error) {
        seen.set(group.transportUrl, { name: group.addonName, count: group.streams.length });
      }
    }
    return [...seen.entries()];
  }, [groups, video]);

  function launchFor(row: Row) {
    return launchForStream({
      meta,
      video,
      stream: row.stream,
      // "embedded" marks streams that came with the meta itself, not from an addon
      transportUrl: row.transportUrl === "embedded" ? null : row.transportUrl,
      addonName: row.addonName,
    });
  }

  /** Direct and torrent streams open Zeiler's Player screen, which resolves and plays
   * them; YouTube and external links leave the app. `backend: "external"` is the row's
   * secondary action ("Open in external mpv"): the same Player screen, with mpv in its
   * own window under Zeiler's remote controls, whatever the backend setting says. */
  async function play(row: Row, backend: "auto" | "external" = "auto") {
    const { stream } = row;
    const launch = launchFor(row);
    if (launch) {
      if (resume) {
        setPhase({ kind: "resume", launch: { ...launch, backend }, rowKey: row.key, resume });
      } else {
        start({ ...launch, backend }, row.key);
      }
      return;
    }
    try {
      if (stream.externalUrl) {
        if (/^https?:\/\//i.test(stream.externalUrl)) await openUrl(stream.externalUrl);
        setPhase({ kind: "idle" });
      } else if (stream.ytId) {
        await openUrl(`https://www.youtube.com/watch?v=${encodeURIComponent(stream.ytId)}`);
        setPhase({ kind: "idle" });
      }
    } catch (e) {
      setFailed((prev) => new Set(prev).add(row.key));
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  }

  /** Opens the Player for `launch` (remembering which row it came from). Started by
   * auto-play, the picker then leaves the view stack: Back from the Player returns to
   * the screen that asked to play. */
  function start(launch: PlayerLaunch, rowKey: string) {
    setPhase({ kind: "idle" });
    opened.current.set(openPlayer(launch), rowKey);
    if (autoStarted.current && onTopRef.current) goBack();
  }

  const backdrop = video?.thumbnail ?? meta.background ?? meta.poster;
  // the list, unless auto-play is still deciding or has started a stream
  const listing = auto === "off";

  return (
    <main className="absolute inset-0 z-50 overflow-y-auto bg-canvas">
      {/* backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        {backdrop ? (
          <img src={backdrop} alt="" className="h-full w-full scale-105 object-cover opacity-50" />
        ) : (
          <div className="h-full w-full" style={{ background: fallbackGradient(meta.id) }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/30 via-canvas/85 to-canvas" />
        <div className="absolute inset-0 bg-gradient-to-r from-canvas/55 via-transparent to-canvas/55" />
      </div>

      <button
        onClick={goBack}
        className="fixed left-5 top-5 z-[200] flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-canvas/80 text-ink backdrop-blur-md transition-colors hover:bg-elevated"
        aria-label="Back"
      >
        <ChevronLeft size={20} strokeWidth={2.2} />
      </button>
      {/* the picker hides the shell's title bar */}
      <div className="fixed right-5 top-5 z-[200]">
        <WindowControls />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col gap-12 px-12 pb-32 pt-32">
        {/* header */}
        <header>
          <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink-subtle">
            {video
              ? `${meta.name} · Season ${video.season ?? "?"} · Episode ${String(video.episode ?? "?").padStart(2, "0")}`
              : [meta.releaseInfo, ...meta.genres.slice(0, 2)].filter(Boolean).join(" · ")}
          </div>
          <h1 className="mt-3 font-display text-[48px] font-medium leading-[0.96] tracking-tight text-ink lg:text-[64px]">
            {video ? (video.title ?? `Episode ${video.episode ?? "?"}`) : meta.name}
          </h1>
          {video?.overview && (
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-muted">
              {video.overview}
            </p>
          )}
        </header>

        {/* searching (auto-play: until the best stream starts) */}
        {((!settled && rows.length === 0) || !listing) && (
          <div className="flex flex-col items-center gap-8 py-24">
            <div className="animate-loader-pulse font-display text-[48px] font-medium text-ink lg:text-[72px]">
              {meta.name}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.42em] text-ink-subtle">
              {listing ? "Searching streams" : "Finding the best stream"}
            </div>
            {!listing && (
              <button
                onClick={() => {
                  autoStarted.current = false;
                  setAuto("off");
                }}
                className="flex h-10 items-center gap-2 rounded-full border border-edge-soft px-5 text-[13px] font-medium text-ink-muted transition-colors hover:border-edge hover:text-ink"
              >
                <ListVideo size={15} />
                Choose a stream instead
              </button>
            )}
          </div>
        )}

        {/* empty */}
        {listing && settled && rows.length === 0 && hidden === 0 && (
          <EmptyState title={`${groups?.length ?? 0} addons answered — nothing playable`}>
            No installed addon returned a stream for{" "}
            <span className="font-mono text-[12px]">{videoId}</span>. Install a stream addon
            that covers this content.
          </EmptyState>
        )}
        {listing && settled && rows.length === 0 && hidden > 0 && (
          <EmptyState title="Nothing for this episode">
            The addons sent {hidden} {hidden === 1 ? "stream" : "streams"} for other episodes, or
            packs that don't say which file is this one. Zeiler leaves those out.
          </EmptyState>
        )}

        {/* why auto-play did not start one */}
        {listing && autoMissed && rows.length > 0 && (
          <p className="-mt-6 text-[13px] text-ink-muted">
            {target
              ? "No stream here is sure to be this episode, so none started by itself."
              : "None of these streams could start by itself."}
          </p>
        )}

        {/* addon filter */}
        {listing && settled && addonOptions.length > 1 && (
          <AddonFilter
            options={addonOptions}
            value={filter}
            total={rows.length}
            onChange={setFilter}
          />
        )}

        {/* rows, in sections by quality, best first */}
        {listing &&
          sections.map((section) => (
            <section key={section.quality} className="flex flex-col gap-2">
              <h2 className="flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-subtle">
                {section.label}
                <span className="font-medium tracking-normal">{section.rows.length}</span>
              </h2>
              {section.rows.map((row) => (
                <StreamRow
                  key={row.key}
                  row={row}
                  best={row.key === best}
                  failed={isFailed(row)}
                  onPlay={() => void play(row)}
                  onPlayExternal={() => void play(row, "external")}
                />
              ))}
            </section>
          ))}
        {listing && settled && rows.length > 0 && hidden > 0 && (
          <p className="-mt-6 px-1 text-[12.5px] text-ink-subtle">
            {hidden} {hidden === 1 ? "stream" : "streams"} for other episodes left out.
          </p>
        )}

        {/* per-addon errors */}
        {listing && settled && (
          <div className="flex flex-wrap gap-2">
            {(groups ?? [])
              .filter((g) => g.error)
              .map((g) => (
                <Badge key={g.transportUrl} tone="warn">
                  {g.addonName}: {g.error}
                </Badge>
              ))}
          </div>
        )}
      </div>

      {/* overlays */}
      {phase.kind === "error" && (
        <Modal title="Could not play" onClose={() => setPhase({ kind: "idle" })}>
          <p className="text-[13.5px] leading-relaxed text-ink">{phase.message}</p>
        </Modal>
      )}
      {phase.kind === "resume" && (
        <ResumePrompt
          resume={phase.resume}
          onResume={() =>
            start({ ...phase.launch, startAtSec: phase.resume.timeOffset / 1000 }, phase.rowKey)
          }
          onStartOver={() => start({ ...phase.launch, startAtSec: null }, phase.rowKey)}
          onClose={() => {
            setPhase({ kind: "idle" });
            // auto-play's prompt closed: the list instead
            autoStarted.current = false;
            setAuto("off");
          }}
        />
      )}
    </main>
  );
}

/** "Resume from 12:34" or start over, before a video with a resume point plays. */
function ResumePrompt({
  resume,
  onResume,
  onStartOver,
  onClose,
}: {
  resume: ResumePoint;
  onResume: () => void;
  onStartOver: () => void;
  onClose: () => void;
}) {
  const at = formatClock(resume.timeOffset);
  const { open: searchOpen } = useSearch();
  // Escape closes the prompt only, not the picker under it (the view stack listens on
  // the window too, after this capture-phase listener). Not while the search sits on
  // top, nor while the Player screen is up (this shell is hidden under it then).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || searchOpen || playerActive()) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, searchOpen]);

  return (
    <Modal title="Pick up where you left off?" onClose={onClose}>
      <p className="text-[13.5px] leading-relaxed text-ink-muted">
        You stopped at {at}
        {resume.duration > resume.timeOffset ? ` of ${formatClock(resume.duration)}` : ""}.
      </p>
      <div className="mt-6 flex flex-col gap-2.5">
        <button
          autoFocus
          onClick={onResume}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-ink px-6 text-[13.5px] font-semibold text-canvas transition-transform hover:scale-[1.02] active:scale-[0.97]"
        >
          <Play size={16} fill="currentColor" />
          Resume from {at}
        </button>
        <button
          onClick={onStartOver}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-edge-soft px-4 text-[13px] font-medium text-ink-muted transition-colors hover:border-edge hover:text-ink"
        >
          <RotateCcw size={15} />
          Start from the beginning
        </button>
      </div>
    </Modal>
  );
}

function AddonFilter({
  options,
  value,
  total,
  onChange,
}: {
  options: [string, { name: string; count: number }][];
  value: string | null;
  total: number;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = value ? options.find(([url]) => url === value) : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-elevated/60 px-4 py-3 text-[15px] font-medium text-ink ring-1 ring-edge-soft transition-colors hover:bg-elevated"
      >
        <span className="flex items-center gap-3">
          <AddonLogo name={selected ? selected[1].name : "All"} size={36} round />
          {selected ? selected[1].name : "All sources"}
        </span>
        <ChevronDown size={17} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="animate-fade-in absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-2xl bg-elevated p-1.5 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.7)] ring-1 ring-edge">
          <FilterOption
            label="All sources"
            count={total}
            active={value === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          />
          {options.map(([url, info]) => (
            <FilterOption
              key={url}
              label={info.name}
              count={info.count}
              active={value === url}
              onClick={() => {
                onChange(url);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterOption({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] ${
        active ? "bg-raised text-ink" : "text-ink-muted hover:bg-raised hover:text-ink"
      }`}
    >
      <AddonLogo name={label} size={28} round />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[12px] text-ink-subtle">{count}</span>
    </button>
  );
}

function StreamRow({
  row,
  best,
  failed,
  onPlay,
  onPlayExternal,
}: {
  row: Row;
  /** the best stream (`bestRow`) */
  best: boolean;
  failed: boolean;
  onPlay: () => void;
  onPlayExternal: () => void;
}) {
  const { stream, addonName } = row;
  const unsupported = !playable(stream) && !stream.externalUrl && !stream.ytId;
  const kindLabel = stream.url
    ? "direct"
    : stream.infoHash
      ? "torrent"
      : stream.ytId
        ? "youtube"
        : stream.externalUrl
          ? "external"
          : "unsupported";
  const badges = streamBadges(stream, { best });

  return (
    <div
      className={`flex items-stretch gap-5 rounded-2xl bg-elevated/40 p-5 ring-1 transition-opacity ${
        failed ? "bg-danger/5 ring-danger/40" : "ring-edge-soft/50"
      }`}
    >
      <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
        <AddonLogo name={addonName} size={56} />
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-subtle">
          {kindLabel}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-line text-[16px] font-semibold leading-snug text-ink">
          {stream.name ?? addonName}
        </div>
        {stream.description && (
          <div className="mt-1 whitespace-pre-line text-[14.5px] leading-snug text-ink-muted">
            {stream.description}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {badges.map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
          {failed && (
            <span className="text-[13px] font-medium text-[oklch(0.75_0.12_25)]">
              Unavailable, try another.
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {playable(stream) && (
          <button
            onClick={onPlayExternal}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-raised text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
            aria-label="Open in external mpv"
            title="Open in external mpv (its own window, controlled from Zeiler)"
          >
            <ExternalLink size={16} />
          </button>
        )}
        <button
          disabled={unsupported}
          onClick={onPlay}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-canvas transition-transform hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Play"
        >
          <Play size={26} fill="currentColor" className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}
