/**
 * The Streams menu: the other streams the addons have for the video playing, and
 * switching to one in the same player.
 *
 * - **Which.** `streams_get` for the same video, asked the way the stream picker asks
 *   (same type, id and episode), when the menu first opens. Rust keeps the addons'
 *   answer for a while (`streams_cache.rs`), so when the picker opened this player the
 *   list is the picker's own, without asking the addons again (and asked again at the
 *   next opening when an addon failed). Ranked, tagged and in sections by quality as in
 *   the picker (lib/streams.ts); only what the Player can play (an http(s) URL or a
 *   torrent), the stream playing marked.
 * - **Switching** (`switchStream`, which loads like the next episode, `player_load`): a
 *   new run in the same player, so the subtitle hook asks for the new file's subtitles
 *   and the title's remembered subtitle and audio choices apply again, as for the next
 *   episode. It starts where this one is: from the beginning within the first
 *   `RESUME_AFTER_SEC`, or once this one ended (Harbor's `use-stream-switcher.ts` rule,
 *   MIT — see THIRD-PARTY-NOTICES.md).
 * - Nothing for live TV, for another file opened in external mpv's window (`foreign`),
 *   or for a launch without a meta.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { launchForOtherStream, type PlayerLaunch } from "../../lib/playback-handoff";
import { errorMessage, streamsGet } from "../../lib/player-ipc";
import {
  episodeTarget,
  hiddenCount,
  playable,
  type StreamRowData,
  streamRows,
  type StreamSection,
  streamSections,
} from "../../lib/streams";
import type { AddonStreams } from "../../lib/types";
import type { PlaybackClock } from "./playback-clock";

/** A switch this early starts the other stream from the beginning. */
export const RESUME_AFTER_SEC = 5;

export interface StreamSwitch {
  /** the addons: not asked yet, being asked, answered, failed */
  listing: "idle" | "loading" | "done" | "error";
  /** the playable streams in sections by quality, best first */
  sections: StreamSection[];
  /** the row of the stream playing (null: not in the list) */
  current: string | null;
  /** streams Rust left out as another episode's */
  hidden: number;
  /** "<addon>: <reason>" per addon that failed, or why the list failed */
  errors: string[];
  /** ask the addons now, if that has not happened for this video (the menu opened) */
  ensureListed: () => void;
  /** play `row`'s stream from where this one is */
  pick: (row: StreamRowData) => void;
}

/** Whether `row` is the stream `launch` plays: the same addon and the same source. */
export function isPlaying(launch: PlayerLaunch, row: StreamRowData): boolean {
  const transportUrl = row.transportUrl === "embedded" ? null : row.transportUrl;
  if (transportUrl !== launch.transportUrl) return false;
  const { stream } = row;
  const source = launch.source;
  if (source.kind === "url") return stream.url === source.url;
  return (
    !!stream.infoHash &&
    stream.infoHash.toLowerCase() === source.infoHash.toLowerCase() &&
    (stream.fileIdx ?? null) === source.fileIdx
  );
}

export function useStreamSwitch({
  launch,
  clock,
  ended,
  foreign,
  switchStream,
}: {
  launch: PlayerLaunch;
  clock: PlaybackClock;
  ended: boolean;
  foreign: boolean;
  switchStream: (next: PlayerLaunch) => void;
}): StreamSwitch | null {
  const meta = launch.meta;
  // the video the picker asked streams for (playbackContext's rule)
  const videoId = meta ? (launch.video?.id ?? meta.behaviorHints.defaultVideoId ?? meta.id) : null;
  // the meta's video (its own streams too), or the launch's numbers for one the Detail
  // page made up (a series without an episode list)
  const video = useMemo(() => {
    const own = launch.video;
    if (!meta || !own) return null;
    return meta.videos.find((v) => v.id === own.id) ?? { ...own, streams: [] };
  }, [meta, launch.video]);
  const available = !!meta && !launch.live && !foreign && videoId !== null;

  const [groups, setGroups] = useState<AddonStreams[] | null>(null);
  const [listing, setListing] = useState<StreamSwitch["listing"]>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  // the video listed (a next episode asks again); the ref for the callbacks
  const listedFor = useRef<string | null>(null);
  const listKey = meta && videoId ? `${meta.type}\n${videoId}` : null;
  useEffect(() => {
    listedFor.current = null;
    setGroups(null);
    setListing("idle");
    setFailure(null);
  }, [listKey]);

  const ensureListed = useCallback(() => {
    if (!available || !meta || !videoId || listedFor.current === listKey) return;
    const asked = listKey;
    listedFor.current = asked;
    setListing("loading");
    setFailure(null);
    streamsGet(meta.type, videoId, episodeTarget(meta, video))
      .then((answer) => {
        if (listedFor.current !== asked) return;
        setGroups(answer);
        setListing("done");
        // an addon failed: the next opening asks again (Rust keeps such an answer 1 min)
        if (answer.some((g) => g.error)) listedFor.current = null;
      })
      .catch((e) => {
        if (listedFor.current !== asked) return;
        // the next opening asks again
        listedFor.current = null;
        setFailure(errorMessage(e));
        setListing("error");
      });
  }, [available, meta, videoId, video, listKey]);

  const rows = useMemo(
    () =>
      streamRows(groups, video).filter(
        (row) => playable(row.stream) && (!row.stream.url || /^https?:\/\//i.test(row.stream.url)),
      ),
    [groups, video],
  );
  const sections = useMemo(() => streamSections(rows), [rows]);
  const current = rows.find((row) => isPlaying(launch, row))?.key ?? null;

  const pick = useCallback(
    (row: StreamRowData) => {
      if (isPlaying(launch, row)) return;
      const position = clock.get().timePos;
      const startAt = !ended && position > RESUME_AFTER_SEC ? position : null;
      const next = launchForOtherStream(
        launch,
        {
          stream: row.stream,
          // "embedded": a stream that came with the meta, as the picker launches it
          transportUrl: row.transportUrl === "embedded" ? null : row.transportUrl,
          addonName: row.addonName,
        },
        startAt,
      );
      if (next) switchStream(next);
    },
    [launch, clock, ended, switchStream],
  );

  if (!available) return null;
  return {
    listing,
    sections,
    current,
    hidden: hiddenCount(groups),
    errors: failure
      ? [failure]
      : (groups ?? []).filter((g) => g.error).map((g) => `${g.addonName}: ${g.error}`),
    ensureListed,
    pick,
  };
}
