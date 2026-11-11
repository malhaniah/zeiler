import { Check, ChevronLeft, ListVideo, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Video } from "../../lib/types";
import type { NextEpisodeControls } from "./useNextEpisode";

export function EpisodeSidebar({ series, next }: { series: string; next: NextEpisodeControls }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seasons = useMemo(() => groupSeasons(next.episodes), [next.episodes]);
  const currentSeason =
    seasons.find((season) => season.videos.some((video) => video.id === next.currentEpisodeId))?.key ??
    seasons[0]?.key ??
    "";
  const [seasonKey, setSeasonKey] = useState(currentSeason);
  useEffect(() => setSeasonKey(currentSeason), [currentSeason]);
  const selectedSeason = seasons.find((season) => season.key === seasonKey) ?? seasons[0];

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const frame = requestAnimationFrame(() => currentRef.current?.scrollIntoView({ block: "center" }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  if (next.episodes.length === 0) return null;
  if (!open) {
    return (
      <button
        ref={toggleRef}
        type="button"
        className="fixed right-0 top-1/2 z-30 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-edge bg-canvas/75 text-ink-muted opacity-70 shadow-lg backdrop-blur-md transition-[opacity,background-color,color] hover:bg-surface hover:text-ink hover:opacity-100 focus-visible:opacity-100"
        onClick={() => setOpen(true)}
        aria-label="Show episodes"
        aria-expanded={false}
        aria-controls="player-episodes"
        title="Episodes"
      >
        <ChevronLeft size={19} />
      </button>
    );
  }

  return (
    <aside
      id="player-episodes"
      aria-label="Episodes"
      className="animate-drawer-in fixed inset-y-0 right-0 z-40 flex w-[min(24rem,90vw)] flex-col border-l border-edge bg-canvas/95 shadow-2xl backdrop-blur-xl"
    >
      <header className="flex items-start gap-4 border-b border-edge-soft px-5 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Now playing</div>
          <h2 className="mt-1 truncate font-display text-2xl font-medium tracking-tight text-ink" title={series}>
            {series}
          </h2>
          <p className="mt-1 text-xs text-ink-subtle">
            {selectedSeason.videos.length} {selectedSeason.videos.length === 1 ? "episode" : "episodes"} in {selectedSeason.label}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink"
          onClick={close}
          aria-label="Close episodes"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
      </header>

      {seasons.length > 1 && (
        <label className="flex items-center gap-3 border-b border-edge-soft px-5 py-4 text-xs font-medium text-ink-subtle">
          Season
          <select
            aria-label="Season"
            value={selectedSeason.key}
            onChange={(e) => {
              setSeasonKey(e.target.value);
              listRef.current?.scrollTo({
                top: 0,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              });
            }}
            className="h-11 min-w-0 flex-1 cursor-pointer rounded-xl border border-edge bg-surface px-3 text-sm font-semibold text-ink outline-none transition-colors hover:border-ink-subtle"
          >
            {seasons.map((season) => (
              <option key={season.key} value={season.key} className="bg-surface text-ink">
                {season.label} · {season.videos.length} {season.videos.length === 1 ? "episode" : "episodes"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
        <section key={selectedSeason.key} aria-label={selectedSeason.label}>
          <div className="flex flex-col gap-1">
            {selectedSeason.videos.map((video, index) => (
              <div
                key={video.id}
                className="animate-card-in"
                style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
              >
                <EpisodeRow
                  video={video}
                  current={next.currentEpisodeId === video.id}
                  pending={next.pendingEpisodeId === video.id}
                  disabled={next.pendingEpisodeId !== null}
                  buttonRef={next.currentEpisodeId === video.id ? currentRef : null}
                  onPlay={() => next.playEpisode(video)}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function EpisodeRow({
  video,
  current,
  pending,
  disabled,
  buttonRef,
  onPlay,
}: {
  video: Video;
  current: boolean;
  pending: boolean;
  disabled: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null> | null;
  onPlay: () => void;
}) {
  const upcoming = isUpcoming(video);
  const number =
    video.season != null && video.episode != null
      ? `S${video.season} E${video.episode}`
      : video.episode != null
        ? `Episode ${video.episode}`
        : "Video";
  const status = current
    ? "Now playing"
    : pending
      ? "Finding a stream…"
      : upcoming
        ? "Upcoming"
        : releasedDate(video);
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={current || upcoming || disabled}
      onClick={onPlay}
      aria-current={current ? "true" : undefined}
      className={`group flex w-full gap-3 rounded-lg border p-2 text-left transition-colors disabled:cursor-default ${
        current
          ? "border-accent/50 bg-accent/10"
          : "border-transparent hover:bg-elevated/70 disabled:opacity-45"
      }`}
    >
      <div className="relative h-[63px] w-28 shrink-0 overflow-hidden rounded-md bg-elevated">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-subtle">
            <ListVideo size={22} />
          </div>
        )}
        {current && (
          <span className="absolute bottom-1 right-1 rounded bg-accent p-0.5 text-canvas" aria-hidden>
            <Check size={11} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${current ? "text-accent" : "text-ink-subtle"}`}>
          {number}
        </div>
        <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
          {video.title ?? number}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
          {pending && <LoaderCircle size={11} className="motion-safe:animate-spin" aria-hidden />}
          {status}
        </div>
      </div>
    </button>
  );
}

function groupSeasons(videos: Video[]): { key: string; label: string; videos: Video[] }[] {
  const groups: { key: string; label: string; videos: Video[] }[] = [];
  for (const video of videos) {
    const key = video.season == null ? "videos" : String(video.season);
    const label = video.season == null ? "Videos" : video.season === 0 ? "Specials" : `Season ${video.season}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label, videos: [] };
      groups.push(group);
    }
    group.videos.push(video);
  }
  return groups;
}

function isUpcoming(video: Video): boolean {
  const released = video.released ? Date.parse(video.released) : Number.NaN;
  return Number.isFinite(released) && released > Date.now();
}

function releasedDate(video: Video): string | null {
  const released = video.released ? Date.parse(video.released) : Number.NaN;
  return Number.isFinite(released) ? new Date(released).toISOString().slice(0, 10) : null;
}
