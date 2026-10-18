/**
 * One playback session: resolves torrents, starts playback through the unified player
 * API and pumps `player://event`s into the page state and the playback clock.
 *
 * Rust picks the backend (`player_start`, see docs/ARCHITECTURE.md "Player backends"):
 * the launch's `backend` ("auto", or "external" when the picker forced it) goes in, the
 * backend actually used comes out, with `fallbackReason` when built-in playback was
 * wanted but failed and mpv took over. Both backends report the same events, so the
 * page drives either with the same calls (`player_set_property`, `player_command`):
 * - embedded libmpv (Windows `embedded` builds): the video sits under the transparent
 *   webview;
 * - external mpv: its own window, remote-controlled over mpv's JSON IPC. Only when that
 *   IPC never comes up (`remoteControl: false`) does the page fall back to the passive
 *   "Playing in mpv" card.
 *
 * Progress is not this page's job: `player_start` gets the launch's `playbackContext`
 * (title, video, episode list) and Rust saves the position, watched marks and Continue
 * Watching from the player's own events, whichever backend plays — also after Back
 * leaves external mpv playing.
 *
 * The session owns its torrent: however the page goes away (Back, Escape, native history
 * navigation, an error), the player is stopped and a torrent it resolved is removed from
 * the engine (honouring `deleteOnStop`) — including one whose resolve only completes
 * after the page is gone, since the engine holds a magnet only once its metadata
 * arrives. The one exception is external mpv that is playing: Back keeps that window
 * playing (and its torrent streaming), as in M1; its Stop button ends both. Back while
 * mpv is still opening the stream cancels it instead (`backKeepsPlaying`).
 *
 * **Next episode** (`loadNext`): another launch of the same title plays in the same
 * player (`player_load`: same window, same backend), resolving its torrent first. It
 * counts as a new run, so the subtitle hook takes its file as the title's own, and from
 * then on `launch` is the new one (the subtitle query, labels, skip times, progress).
 * The session then owns the new torrent; the old one is removed once the new file is
 * asked for, unless it is the same torrent (another file of a season pack).
 *
 * **Another stream** (`switchStream`, the Streams menu): the same load, for another
 * stream of the video playing, starting where it was (the launch's `startAtSec`). The
 * file playing pauses while a torrent resolves, so nothing is missed, and plays on if
 * that fails. A stream Rust refuses (a scheme or a header it does not take) is refused
 * before mpv is asked: the file before plays on, with a notice, for either kind of load.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorKind } from "../../lib/ipc";
import { libraryGet } from "../../lib/library-ipc";
import {
  leavePlayer,
  playbackContext,
  type PlayerLaunch,
  playerActive,
  urlRequest,
} from "../../lib/playback-handoff";
import {
  type ActiveBackend,
  engineRemove,
  engineResolve,
  errorMessage,
  onPlayerEvent,
  type PlaybackRequest,
  type PlayerEvent,
  playerBackends,
  playerLoad,
  playerSetProperty,
  playerStart,
  playerStop,
  settingsGet,
} from "../../lib/player-ipc";
import { type Backend, INITIAL_MPV, type MpvState, mpvReducer, type Phase } from "./mpv-state";
import { applyClockEvent, type PlaybackClock } from "./playback-clock";

/** Best-effort: drop a torrent from the engine (deleting its files per settings). */
export async function removeTorrent(infoHash: string): Promise<void> {
  try {
    const settings = await settingsGet();
    await engineRemove(infoHash, settings.deleteOnStop);
  } catch {
    /* best effort: the engine may not hold it (yet, or any more) */
  }
}

/**
 * Whether Back leaves external mpv running in this phase (the screen says so). Only
 * while it plays: Back while it is still opening cancels, and after it ended, failed
 * or was closed, Back closes mpv. (The passive "Playing in mpv" card keeps it too.)
 */
export function backKeepsPlaying(kind: Phase["kind"]): boolean {
  return kind === "playing" || kind === "uncontrolled";
}

/** The message for a failed start: an explicit Built-in choice that this build or OS
 * cannot honour points to the setting (which shows why, in Settings → Player). */
export function startErrorMessage(e: unknown): string {
  if (errorKind(e) === "unsupported") {
    return "Built-in playback is chosen in Settings → Player, but it isn't available on this computer. Choose Auto or External mpv there.";
  }
  return errorMessage(e);
}

/** Where the library says this launch's video stopped, in seconds (null: none). */
async function resumeAtSec(launch: PlayerLaunch): Promise<number | null> {
  const context = playbackContext(launch);
  if (!context) return null;
  const detail = await libraryGet(context.meta.id).catch(() => null);
  const resume = detail?.entry.resume;
  return resume && resume.videoId === context.videoId ? resume.timeOffset / 1000 : null;
}

/** Where the Rust-side player of this session stands. */
type PlayerSlot =
  | { state: "idle" } // player_start not sent yet
  | { state: "starting" } // player_start in flight
  | { state: "running"; backend: ActiveBackend }
  | { state: "gone" }; // stopped by us, shut down on its own, or never started

export interface PlaybackSession {
  /** the launch playing now: the page's, or the one `loadNext` moved on to */
  launch: PlayerLaunch;
  phase: Phase;
  backend: Backend;
  /**
   * A built-in (embedded) session is running, so the native video sits behind the
   * page. Until then — and once it has stopped — the page paints its own background:
   * `backend` can already be "embedded" (the early guess) while nothing is behind it.
   */
  videoBehind: boolean;
  mpv: MpvState;
  /** a non-fatal player error, dismissible */
  notice: string | null;
  dismissNotice: () => void;
  /** why built-in playback fell back to external mpv, dismissible */
  fallbackReason: string | null;
  dismissFallback: () => void;
  /** start the same stream again (after mpv was closed), where the library says it stopped */
  playAgain: () => void;
  /** stop the player, drop the torrent, leave the page (external mpv's Stop) */
  stopAndLeave: () => Promise<void>;
  /** play another launch of the title in the same player (the next episode) */
  loadNext: (next: PlayerLaunch) => void;
  /** play another stream of the video in the same player (the Streams menu) */
  switchStream: (next: PlayerLaunch) => void;
  /**
   * Follow this session's events (only those of its own player, as the page sees them);
   * returns the unsubscribe function. `run` counts the page's player starts: the events
   * after Play again carry a higher one than those before it.
   */
  subscribeEvents: (listener: PlayerEventListener) => () => void;
}

export type PlayerEventListener = (event: PlayerEvent, run: number) => void;

/** What a load in the same player says while it opens, and when it fails before; and
 * whether the file playing waits, paused, while a torrent resolves (another stream of
 * the same video starts where this one is). */
interface LoadWords {
  opening: string;
  failed: string;
  pauseWhileResolving: boolean;
}
const NEXT_EPISODE: LoadWords = {
  opening: "Opening the next episode…",
  failed: "Could not open the next episode",
  pauseWhileResolving: false,
};
const OTHER_STREAM: LoadWords = {
  opening: "Opening the stream…",
  failed: "Could not open that stream",
  pauseWhileResolving: true,
};

export function usePlaybackSession(
  launch: PlayerLaunch,
  clock: PlaybackClock,
  sendGeometry: () => void,
): PlaybackSession {
  const [current, setCurrent] = useState(launch);
  const [phase, setPhase] = useState<Phase>({ kind: "loading", label: "Preparing player…" });
  const [backend, setBackend] = useState<Backend>("unknown");
  const [videoBehind, setVideoBehind] = useState(false);
  const [mpv, dispatch] = useReducer(mpvReducer, INITIAL_MPV);
  const [notice, setNotice] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const listeners = useRef(new Set<PlayerEventListener>());
  const actions = useRef<{
    playAgain: () => void;
    stopAndLeave: () => Promise<void>;
    load: (next: PlayerLaunch, words: LoadWords) => void;
  }>({
    playAgain: () => undefined,
    stopAndLeave: async () => leavePlayer(),
    load: () => undefined,
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let player: PlayerSlot = { state: "idle" };
    // set while our own Stop runs, so the shutdown it causes is not shown as "closed"
    let stopping = false;
    let request: PlaybackRequest | null = null;
    // player starts and next-episode loads so far (Play again and loadNext make
    // another): the run events belong to
    let run = 0;
    // the launch playing (loadNext moves it on), and whether a loadNext is under way
    // (one at a time)
    let playing = launch;
    let loadingNext = false;
    // the file before reached its end while the next one was opening
    let endedMeanwhile = false;
    const source = launch.source;
    // the torrent playing now (the next episode's may replace it)
    let owned: string | null = source.kind === "torrent" ? source.infoHash : null;
    // every torrent this session holds in the engine and has not removed yet: the
    // cleanup and a late start/resolve may both drop one, so each goes once — until a
    // later resolve adds it again (back to an earlier episode)
    const held = new Set<string>(owned ? [owned] : []);
    const drop = (hash: string | null) => {
      if (!hash || !held.has(hash)) return;
      held.delete(hash);
      void removeTorrent(hash);
    };
    const dropTorrent = () => {
      for (const hash of [...held]) drop(hash);
    };

    const fail = (e: unknown) => {
      if (cancelled) return;
      const failed = playing.source;
      setPhase({
        kind: "error",
        message: startErrorMessage(e),
        // mpv missing or failing to launch: a direct URL still plays in any other player
        // (not a live channel's: an IPTV stream URL carries the account)
        streamUrl:
          errorKind(e) === "player" && failed.kind === "url" && !playing.live
            ? failed.url
            : undefined,
      });
    };

    const onEvent = (event: PlayerEvent) => {
      // events of a session left playing by an earlier launch, until ours replaces it
      if (player.state === "idle" || player.state === "gone") return;
      if (!applyClockEvent(clock, event)) dispatch(event);
      for (const listener of [...listeners.current]) listener(event, run);
      switch (event.type) {
        case "file-loaded":
        case "playback-restart":
          if (player.state === "running" && player.backend === "embedded") sendGeometry();
          if (phaseRef.current.kind === "loading") setPhase({ kind: "playing" });
          break;
        case "end-file":
          // (the episode before reaching its end while the next one opens is no news)
          if (event.reason === "eof") {
            if (loadingNext) endedMeanwhile = true;
            else setPhase({ kind: "ended" });
          }
          else if (event.reason === "error" && phaseRef.current.kind !== "error") {
            setPhase({ kind: "error", message: "playback failed (stream error)" });
          }
          break;
        case "error":
          // fatal only if nothing ever loaded
          if (phaseRef.current.kind === "loading") {
            setPhase({ kind: "error", message: event.message });
          } else {
            setNotice(event.message);
          }
          break;
        case "property":
          if (event.name === "eof-reached") {
            if (event.value === true) {
              if (loadingNext) endedMeanwhile = true;
              else setPhase({ kind: "ended" });
            }
            else if (phaseRef.current.kind === "ended") setPhase({ kind: "playing" });
          }
          break;
        case "shutdown":
          player = { state: "gone" };
          setVideoBehind(false);
          if (!stopping && phaseRef.current.kind !== "error") setPhase({ kind: "closed" });
          break;
      }
    };

    /** player_start for the prepared request; Rust picks (and reports) the backend. */
    const start = async () => {
      if (!request) return;
      setPhase({ kind: "loading", label: "Starting playback…" });
      player = { state: "starting" };
      run += 1;
      setVideoBehind(false);
      let result;
      try {
        // with the context, Rust saves this playback's progress to the library
        result = await playerStart(request, launch.backend, playbackContext(playing));
      } catch (e) {
        // A refused start leaves nothing of ours running: Rust validates the request
        // before it replaces the previous session, and a later failure has already
        // stopped what it spawned. So the cleanup must not stop a session an earlier
        // screen left playing (nor follow its events).
        player = { state: "gone" };
        throw e;
      }
      if (cancelled) {
        // The page left while the player was starting. Its cleanup sent a stop, but
        // Rust may have run it before this start; stop again unless another player
        // screen is already up (whose session this stop would hit instead).
        if (!playerActive()) void playerStop().catch(() => undefined);
        dropTorrent();
        return;
      }
      player = { state: "running", backend: result.backend };
      setBackend(result.backend);
      setVideoBehind(result.backend === "embedded");
      setFallbackReason(result.fallbackReason ?? null);
      if (!result.remoteControl) {
        setPhase({ kind: "uncontrolled" });
        return;
      }
      if (result.backend === "embedded") sendGeometry();
      // events may already have moved the phase on (file-loaded can beat the reply)
      setPhase((p) =>
        p.kind === "loading"
          ? {
              kind: "loading",
              label: result.backend === "external" ? "Opening in mpv…" : "Opening the stream…",
            }
          : p,
      );
    };

    actions.current = {
      // Again from where the library now says this video stopped (the launch's own
      // start point, e.g. a resume, is stale by then); from the beginning without one.
      playAgain: () => {
        dispatch({ type: "start-file" });
        void (async () => {
          if (request) request = { ...request, startAtSec: await resumeAtSec(playing) };
          if (!cancelled) await start();
        })().catch(fail);
      },
      stopAndLeave: async () => {
        stopping = true;
        await playerStop().catch(() => undefined);
        player = { state: "gone" };
        setVideoBehind(false);
        dropTorrent();
        leavePlayer();
      },
      load: (next, words) => {
        if (cancelled || player.state !== "running" || loadingNext) return;
        loadingNext = true;
        endedMeanwhile = false;
        // the file before stays loaded until the next one is asked for: a failure up
        // to then leaves it as it was, with a notice
        const before = phaseRef.current;
        setPhase({ kind: "loading", label: words.opening });
        let switched = false;
        const pausedHere =
          words.pauseWhileResolving && next.source.kind === "torrent" && !clock.get().pause;
        if (pausedHere) void playerSetProperty("pause", true).catch(() => undefined);
        void (async () => {
          let prepared: PlaybackRequest;
          let hash: string | null = null;
          if (next.source.kind === "url") {
            prepared = urlRequest(next.source, next);
          } else {
            hash = next.source.infoHash;
            const resolved = await engineResolve({
              infoHash: next.source.infoHash,
              fileIdx: next.source.fileIdx,
              sources: next.source.sources,
              filename: next.source.filename,
              fileMustInclude: next.source.fileMustInclude,
            });
            if (cancelled) {
              // The page left while the magnet resolved: its cleanup removed what the
              // session held, which did not include this one yet.
              if (!held.has(hash)) void removeTorrent(hash);
              return;
            }
            held.add(hash);
            if (player.state !== "running") {
              // the player went away meanwhile (mpv closed): nobody plays it
              if (hash !== owned) drop(hash);
              return;
            }
            prepared = {
              url: resolved.streamUrl,
              title: next.title ?? resolved.fileName ?? null,
              headers: [],
              userAgent: null,
              referrer: null,
              startAtSec: next.startAtSec,
            };
          }
          if (player.state !== "running") return;
          const previousRequest = request;
          const previousLaunch = playing;
          request = prepared;
          const previous = owned;
          owned = hash;
          playing = next;
          // a run of its own: the subtitle hook takes this file as the title's again
          run += 1;
          switched = true;
          setCurrent(next);
          try {
            await playerLoad(prepared, playbackContext(next));
          } catch (e) {
            if (errorKind(e) !== "invalidInput") throw e;
            // refused before mpv was asked: the file before plays on
            request = previousRequest;
            owned = previous;
            playing = previousLaunch;
            setCurrent(previousLaunch);
            switched = false;
            if (hash && hash !== previous) drop(hash);
            throw e;
          }
          if (previous && previous !== hash) drop(previous);
        })()
          .catch((e) => {
            if (cancelled) return;
            if (switched) {
              fail(e);
            } else {
              setPhase(endedMeanwhile ? { kind: "ended" } : before);
              setNotice(`${words.failed}: ${errorMessage(e)}`);
              if (pausedHere) void playerSetProperty("pause", false).catch(() => undefined);
            }
          })
          .finally(() => {
            loadingNext = false;
          });
      },
    };

    (async () => {
      // the backend this launch will most likely get, so the loading screen fits
      const [backends, settings] = await Promise.all([
        playerBackends().catch(() => null),
        settingsGet().catch(() => null),
      ]);
      if (cancelled) return;
      const wanted =
        launch.backend === "auto" ? (settings?.playerBackend ?? "auto") : launch.backend;
      setBackend(wanted !== "external" && backends?.embedded.available ? "embedded" : "external");

      const prepared: PlaybackRequest =
        source.kind === "url"
          ? urlRequest(source, launch)
          : {
              url: "",
              title: launch.title,
              headers: [],
              userAgent: null,
              referrer: null,
              startAtSec: launch.startAtSec,
            };
      if (source.kind === "torrent") {
        setPhase({ kind: "loading", label: "Finding peers and fetching metadata…" });
        const resolved = await engineResolve({
          infoHash: source.infoHash,
          fileIdx: source.fileIdx,
          sources: source.sources,
          filename: source.filename,
          fileMustInclude: source.fileMustInclude,
        });
        if (cancelled) {
          // The page left while the magnet was resolving: the cleanup's remove found
          // nothing (the engine holds a magnet only once its metadata arrives), so
          // remove the torrent it has only just added — past the run-once guard, which
          // that no-op remove already tripped.
          held.delete(source.infoHash);
          void removeTorrent(source.infoHash);
          return;
        }
        prepared.url = resolved.streamUrl;
        prepared.title ??= resolved.fileName ?? null;
      }
      if (!prepared.url) throw new Error("nothing to play: the route carried no url/infoHash");
      request = prepared;

      unlisten = await onPlayerEvent(onEvent);
      if (cancelled) return;
      await start();
    })().catch(fail);

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
      // Back keeps external mpv playing (and its torrent streaming), as in M1
      const keepPlaying =
        player.state === "running" &&
        player.backend === "external" &&
        backKeepsPlaying(phaseRef.current.kind);
      if (keepPlaying) return;
      const stopped =
        player.state === "starting" || player.state === "running"
          ? playerStop().catch(() => undefined)
          : Promise.resolve();
      player = { state: "gone" };
      void stopped.then(dropTorrent);
    };
    // launch and clock are fixed for the lifetime of the page
  }, [launch, clock, sendGeometry]);

  const playAgain = useCallback(() => actions.current.playAgain(), []);
  const stopAndLeave = useCallback(() => actions.current.stopAndLeave(), []);
  const loadNext = useCallback((next: PlayerLaunch) => actions.current.load(next, NEXT_EPISODE), []);
  const switchStream = useCallback(
    (next: PlayerLaunch) => actions.current.load(next, OTHER_STREAM),
    [],
  );
  const subscribeEvents = useCallback((listener: PlayerEventListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  return {
    launch: current,
    phase,
    backend,
    videoBehind,
    mpv,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    fallbackReason,
    dismissFallback: useCallback(() => setFallbackReason(null), []),
    playAgain,
    stopAndLeave,
    loadNext,
    switchStream,
    subscribeEvents,
  };
}
