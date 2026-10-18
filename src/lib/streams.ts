/**
 * Streams as the stream picker shows them. Rust tags every addon's streams, leaves out
 * those for another episode and ranks the rest across the addons (`streams_get`,
 * crates/zeiler-streams); here the ranked streams become rows in sections by quality,
 * best first, and the tags become badges.
 */
import type {
  AddonStreams,
  EpisodeTarget,
  Stream,
  StreamQuality,
  StreamTags,
  Video,
} from "./types";

/** One stream as a row of the list. */
export interface StreamRowData {
  stream: Stream;
  addonName: string;
  /** the addon's transport URL; "embedded" for a stream that came with the meta */
  transportUrl: string;
  /** unique in the list */
  key: string;
}

/**
 * The episode to ask `streams_get` for: the video's season and episode, and its number
 * counted across the regular seasons (the episodes of the seasons before it, by their
 * numbers, plus its own), for anime releases numbered that way. Null for a movie or a
 * video without an episode number: nothing is left out then.
 */
export function episodeTarget(meta: { videos: Video[] }, video: Video | null): EpisodeTarget | null {
  if (!video || video.episode == null) return null;
  const season = video.season ?? null;
  let absolute: number | null = null;
  if (season !== null && season >= 1) {
    const before = new Set<string>();
    for (const v of meta.videos) {
      if (v.season != null && v.season >= 1 && v.season < season && v.episode != null) {
        before.add(`${v.season}:${v.episode}`);
      }
    }
    absolute = before.size + video.episode;
  }
  return { season, episode: video.episode, absolute };
}

/** The rows: the meta's own streams first, as they came, then the addons' best first
 * (their rank across every addon; equal ranks keep the addons' order). */
export function streamRows(groups: AddonStreams[] | null, video: Video | null): StreamRowData[] {
  const embedded: StreamRowData[] = (video?.streams ?? []).map((stream, i) => ({
    stream,
    addonName: "Embedded",
    transportUrl: "embedded",
    key: `embedded-${i}`,
  }));
  const ranked: StreamRowData[] = [];
  for (const group of groups ?? []) {
    group.streams.forEach((stream, i) =>
      ranked.push({
        stream,
        addonName: group.addonName,
        transportUrl: group.transportUrl,
        key: `${group.transportUrl}-${i}`,
      }),
    );
  }
  const rankOf = (row: StreamRowData) => row.stream.rank ?? Number.MAX_SAFE_INTEGER;
  // Array.prototype.sort is stable: equal ranks keep the addons' order
  ranked.sort((a, b) => rankOf(a) - rankOf(b));
  return [...embedded, ...ranked];
}

/** How many streams Rust left out as another episode's. */
export function hiddenCount(groups: AddonStreams[] | null): number {
  return (groups ?? []).reduce((n, g) => n + (g.hidden ?? 0), 0);
}

export const QUALITY_LABELS: Record<StreamQuality, string> = {
  "4k": "4K",
  "1080p": "1080p",
  "720p": "720p",
  sd: "SD",
  unknown: "Other",
  low: "Low quality",
};

export interface StreamSection {
  /** "embedded": the streams that came with the meta */
  quality: StreamQuality | "embedded";
  label: string;
  rows: StreamRowData[];
}

/**
 * Rows (in `streamRows`' order) in sections by quality: the meta's own streams first,
 * then a section per quality, in the order of their best stream, each best first.
 */
export function streamSections(rows: StreamRowData[]): StreamSection[] {
  const sections = new Map<StreamQuality | "embedded", StreamSection>();
  for (const row of rows) {
    const quality = row.transportUrl === "embedded" ? "embedded" : (row.stream.tags?.quality ?? "unknown");
    let section = sections.get(quality);
    if (!section) {
      section = {
        quality,
        label: quality === "embedded" ? "With the title" : QUALITY_LABELS[quality],
        rows: [],
      };
      sections.set(quality, section);
    }
    section.rows.push(row);
  }
  return [...sections.values()];
}

/** The stream Zeiler's player can play (a URL or a torrent; not YouTube or a link). */
export function playable(stream: Stream): boolean {
  return !!(stream.url || stream.infoHash);
}

/**
 * The best stream (rows in `streamRows`' order): the best ranked addon stream the
 * Player can play that is the episode asked for (the episode itself, or in a pack that
 * names its file; any for a film), else the first playable stream that came with the
 * meta. A stream that names no episode is never the best for one. Null when there is
 * none. `usable` leaves out rows that cannot start (one that already failed).
 */
export function bestRow(
  rows: StreamRowData[],
  usable: (row: StreamRowData) => boolean = () => true,
): StreamRowData | null {
  const fits = (row: StreamRowData) => playable(row.stream) && usable(row);
  return (
    rows.find((r) => r.transportUrl !== "embedded" && fits(r) && r.stream.episodeMatch !== "unknown") ??
    rows.find((r) => r.transportUrl === "embedded" && fits(r)) ??
    null
  );
}

const RESOLUTION_LABELS: Record<NonNullable<StreamTags["resolution"]>, string> = {
  "2160p": "4K",
  "1440p": "1440p",
  "1080p": "1080p",
  "720p": "720p",
  "576p": "576p",
  "480p": "480p",
  "360p": "360p",
};

const SOURCE_LABELS: Record<NonNullable<StreamTags["source"]>, string> = {
  cam: "CAM",
  telesync: "Telesync",
  telecine: "Telecine",
  screener: "Screener",
  remux: "REMUX",
  bluray: "BluRay",
  "web-dl": "WEB-DL",
  webrip: "WEBRip",
  hdtv: "HDTV",
  hdrip: "HDRip",
  dvd: "DVD",
};

const HDR_LABELS: Record<StreamTags["hdr"][number], string> = {
  dv: "Dolby Vision",
  "hdr10+": "HDR10+",
  hdr10: "HDR10",
  hdr: "HDR",
  hlg: "HLG",
};

const CODEC_LABELS: Record<NonNullable<StreamTags["codec"]>, string> = {
  hevc: "HEVC",
  av1: "AV1",
  vp9: "VP9",
  avc: "H.264",
  xvid: "XviD",
};

const AUDIO_LABELS: Record<StreamTags["audio"][number], string> = {
  atmos: "Atmos",
  truehd: "TrueHD",
  "dts-x": "DTS:X",
  "dts-hd-ma": "DTS-HD MA",
  "dts-hd": "DTS-HD",
  dts: "DTS",
  "dd+": "DD+",
  dd: "DD",
  aac: "AAC",
  flac: "FLAC",
  opus: "Opus",
  pcm: "PCM",
};

const LOW_SOURCES = new Set<StreamTags["source"]>(["cam", "telesync", "telecine", "screener"]);

/** "4.5 GB", "700 MB" (decimal units, as addons label sizes). */
export function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : bytes >= 1e10 ? 1 : 2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export interface StreamBadge {
  label: string;
  tone: "default" | "warn" | "accent";
}

/**
 * A stream's badges: Best (`best`, see `bestRow`), the resolution (unless its section
 * already says it), the source, HDR, codec and bit depth, audio and channels, size,
 * seeders, whether a debrid service has it, and Pack. `compact` keeps the ones that
 * tell streams apart most (the in-player menu): source, the first HDR and audio format,
 * size, seeders, debrid.
 */
export function streamBadges(
  stream: Stream,
  { best = false, compact = false }: { best?: boolean; compact?: boolean } = {},
): StreamBadge[] {
  const badges: StreamBadge[] = [];
  const add = (label: string, tone: StreamBadge["tone"] = "default") => badges.push({ label, tone });
  if (best) add("Best", "accent");
  const tags = stream.tags;
  if (!tags) {
    const size = stream.behaviorHints.videoSize;
    if (size) add(formatSize(size));
    return badges;
  }
  // the 4K, 1080p and 720p sections name their resolution
  if (tags.resolution && (tags.quality === "sd" || tags.quality === "low")) {
    add(RESOLUTION_LABELS[tags.resolution]);
  }
  if (tags.source) add(SOURCE_LABELS[tags.source], LOW_SOURCES.has(tags.source) ? "warn" : "default");
  for (const hdr of compact ? tags.hdr.slice(0, 1) : tags.hdr) add(HDR_LABELS[hdr]);
  if (!compact) {
    if (tags.codec) add(CODEC_LABELS[tags.codec]);
    if (tags.bitDepth && tags.bitDepth > 8) add(`${tags.bitDepth}-bit`);
  }
  for (const audio of compact ? tags.audio.slice(0, 1) : tags.audio) add(AUDIO_LABELS[audio]);
  if (!compact && tags.channels && tags.channels !== "2.0") add(tags.channels);
  if (tags.size) add(formatSize(tags.size));
  if (tags.seeders !== null && stream.infoHash) {
    add(`${tags.seeders} ${tags.seeders === 1 ? "seed" : "seeds"}`, tags.seeders === 0 ? "warn" : "default");
  }
  if (tags.cached === true) add("Cached", "accent");
  if (tags.cached === false) add("Not cached", "warn");
  if (stream.episodeMatch === "pack") add("Pack");
  return badges;
}
