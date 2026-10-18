/**
 * The player's actions and keyboard shortcuts, shared by both screens: the embedded
 * chrome (video under the webview) and the external-mpv remote (mpv in its own
 * window). Every action goes through the backend-neutral, allow-listed player API, so
 * the same code drives either backend; only fullscreen differs (the caller passes it).
 *
 * Keys work while the Zeiler window has focus: Space play/pause (replay once ended),
 * ←/→ seek 5 s, ↑/↓ volume ±5, m mute, f fullscreen, s next subtitle, c next second
 * subtitle, z/x subtitle delay −/+0.1 s, [ / ] slower/faster, Escape back. A focused text field
 * keeps its own keys, and so does the focused volume slider for the arrows; the seek
 * bar does not (its native step is a fraction of a second), so ←/→ still seek 5 s after
 * a click on it. An open menu takes Escape first (it closes, see ControlsBar).
 *
 * The mouse wheel over the screen is the volume too (`usePlayerWheel`, see `wheelStep`):
 * up louder, down quieter, in the ↑/↓ steps — not while a menu is open, and not over
 * something that scrolls.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PLAYER_MENU_ATTR } from "./menu";
import { playerCommand, playerSetProperty } from "../../lib/player-ipc";
import type { MpvState } from "./mpv-state";
import { useLive } from "./live";
import type { PlaybackClock } from "./playback-clock";

export const SEEK_STEP_SEC = 5;
/** The z/x subtitle delay step, in seconds. */
export const SUB_DELAY_STEP = 0.1;
/** The speeds the menu offers and [ / ] step through. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** How long a z/x, [ / ] or volume step builds on the previous one rather than on mpv's
 * value. */
const CHAIN_MS = 1000;

interface Asked {
  value: number;
  at: number;
}
export const VOLUME_STEP = 5;
/** Pixel scrolling (a trackpad): this far makes a volume step after a gesture's first. */
export const WHEEL_PX_PER_STEP = 120;
/** At most one pixel-scrolling step this often. */
export const WHEEL_MIN_INTERVAL_MS = 100;
/** The most steps one pixel-scrolling gesture makes: a fling's momentum runs on after
 * the fingers have left the trackpad. */
export const WHEEL_MAX_GESTURE_STEPS = 10;
/** A pause this long between wheel events starts a new gesture. */
export const WHEEL_IDLE_MS = 250;
/** The most notches one event counts (the webview merges the events it could not
 * deliver in time, adding up their notches). */
const WHEEL_MAX_NOTCHES = 3;
/** WebKit on macOS reports a mouse wheel's notch as a multiple of a tenth of a line,
 * 0.1000061 × 40 px (MapLibre's sign of a mouse wheel); a trackpad's pixels are not. */
const MAC_NOTCH_PX = 4.000244140625;
/** The volume slider's and the ↑ key's ceiling until the settings say otherwise
 * (`audio.volumeMax`, which Rust also gives mpv as `volume-max`). */
export const VOLUME_MAX = 100;
/** Marks the seek bar's range input, whose arrow keys the window shortcuts take over. */
export const SEEK_SLIDER_ATTR = "data-seek-slider";

/**
 * The volume after a ↑/↓ step. Clamped to 0…`max`, except that a volume already above
 * it (external mpv: its own keys) is never pulled down by ↑ and steps down from where
 * it is with ↓.
 */
export function nextVolume(current: number, delta: number, max = VOLUME_MAX): number {
  const now = Math.round(current);
  const ceiling = Math.max(max, now);
  return Math.min(ceiling, Math.max(0, now + delta));
}

/** Where a run of wheel events stands (`wheelStep`). */
export interface WheelState {
  /** pixel distance not yet turned into a step, up positive, in steps */
  pending: number;
  /** when the last event, and the last step, came */
  lastEventAt: number;
  lastStepAt: number;
  /** this gesture has had pixel scrolling (a trackpad), so it stays pixel scrolling */
  pixels: boolean;
  /** the steps its pixel scrolling made */
  steps: number;
}

export const WHEEL_IDLE: WheelState = {
  pending: 0,
  lastEventAt: -Infinity,
  lastStepAt: -Infinity,
  pixels: false,
  steps: 0,
};

/** What a wheel event says, as a browser reports it. */
export interface WheelInput {
  deltaX: number;
  /** pixels: about 100 per mouse-wheel notch on Windows, a multiple of `MAC_NOTCH_PX`
   * on macOS (4 for a slow notch) */
  deltaY: number;
  /** 0: pixels (every webview's mouse wheel and trackpad); 1, 2: lines, pages */
  deltaMode: number;
  /** the legacy WebKit/Blink `wheelDeltaY`: 120 per mouse-wheel notch on Windows and
   * Linux */
  wheelDeltaY?: number;
  /** WebKit's `webkitDirectionInvertedFromDevice`: the OS turned the direction round
   * (macOS natural scrolling) */
  inverted?: boolean;
}

/**
 * One wheel event's volume steps (+ louder, − quieter, 0 none) and the state for the
 * next event. Up is louder by the wheel's or the fingers' own direction where the
 * webview says the OS turned it round (macOS natural scrolling, on by default); other
 * webviews report the direction content scrolls. Sideways scrolling is none.
 *
 * - A gesture's first event (after `WHEEL_IDLE_MS` without one) is a step at once.
 * - Then a mouse wheel's notches are a step each: lines or pages, a `wheelDeltaY` that
 *   is a multiple of 120 (up to `WHEEL_MAX_NOTCHES` for merged events), or on macOS a
 *   `deltaY` that is a multiple of `MAC_NOTCH_PX` (one per event: macOS accelerates
 *   a notch's size, not the number of events).
 * - Pixel scrolling (a trackpad, a free-spinning or high-resolution wheel) adds up:
 *   `WHEEL_PX_PER_STEP` is a step, at most one every `WHEEL_MIN_INTERVAL_MS` and
 *   `WHEEL_MAX_GESTURE_STEPS` per gesture; what is left is dropped when the gesture
 *   turns or ends, never banked beyond one step. Once a gesture has had pixel
 *   scrolling it stays so (WebKit gives a trackpad's 40 px a `wheelDeltaY` of 120).
 */
export function wheelStep(state: WheelState, input: WheelInput, now: number): { state: WheelState; steps: number } {
  const { deltaX, deltaY, deltaMode, wheelDeltaY, inverted } = input;
  if (deltaY === 0 || Math.abs(deltaX) > Math.abs(deltaY)) return { state, steps: 0 };
  const sign = (deltaY < 0) !== !!inverted ? 1 : -1;
  const notches =
    wheelDeltaY && Math.abs(wheelDeltaY) % 120 === 0
      ? Math.abs(wheelDeltaY) / 120
      : Math.abs(deltaY) % MAC_NOTCH_PX === 0
        ? 1
        : 0;
  const notch = deltaMode !== 0 || notches > 0;
  if (now - state.lastEventAt > WHEEL_IDLE_MS) {
    const steps = notch ? Math.min(WHEEL_MAX_NOTCHES, Math.max(1, notches)) : 1;
    return {
      state: { pending: 0, lastEventAt: now, lastStepAt: now, pixels: !notch, steps: notch ? 0 : 1 },
      steps: sign * steps,
    };
  }
  if (notch && !state.pixels) {
    return {
      state: { ...state, pending: 0, lastEventAt: now, lastStepAt: now },
      steps: sign * Math.min(WHEEL_MAX_NOTCHES, Math.max(1, notches)),
    };
  }
  // pixel scrolling adds up; a gesture that turns starts again
  let pending = state.pending !== 0 && (state.pending > 0) !== (sign > 0) ? 0 : state.pending;
  pending = Math.max(-1, Math.min(1, pending + (sign * Math.abs(deltaY)) / WHEEL_PX_PER_STEP));
  const next = { ...state, pending, lastEventAt: now, pixels: true };
  if (
    Math.abs(pending) < 1 ||
    now - state.lastStepAt < WHEEL_MIN_INTERVAL_MS ||
    state.steps >= WHEEL_MAX_GESTURE_STEPS
  ) {
    return { state: next, steps: 0 };
  }
  return {
    state: { ...next, pending: pending - sign, lastStepAt: now, steps: state.steps + 1 },
    steps: sign,
  };
}

export interface PlayerControls {
  togglePauseOrReplay: () => void;
  seekBy: (deltaSec: number) => void;
  changeVolume: (delta: number) => void;
  /** the volume slider's value (unmutes) */
  setVolume: (value: number) => void;
  toggleMute: () => void;
  /** the next subtitle track (and Off), as mpv orders them */
  cycleSubtitles: () => void;
  /** the next second subtitle (and none) */
  cycleSecondarySubtitles: () => void;
  stepSubDelay: (deltaSec: number) => void;
  /** the next speed of SPEEDS up (+1) or down (-1) */
  stepSpeed: (direction: 1 | -1) => void;
}

/** The speed after a [ or ] from `current`. */
export function nextSpeed(current: number, direction: 1 | -1): number {
  const faster = SPEEDS.find((s) => s > current + 1e-3);
  const slower = [...SPEEDS].reverse().find((s) => s < current - 1e-3);
  return (direction > 0 ? faster : slower) ?? current;
}

export function usePlayerControls({
  clock,
  mpv,
  ended,
  volumeMax = VOLUME_MAX,
  poke,
}: {
  clock: PlaybackClock;
  mpv: MpvState;
  ended: boolean;
  /** the volume's ceiling (`audio.volumeMax`) */
  volumeMax?: number;
  /** called after every action (shows auto-hiding controls) */
  poke: () => void;
}): PlayerControls {
  // read at call time, so the callbacks stay stable across volume/mute changes
  const latest = useRef(mpv);
  latest.current = mpv;
  const ceiling = useRef(volumeMax);
  ceiling.current = volumeMax;

  // Steps pressed faster than mpv reports them build on the last one asked for, not on
  // a value mpv has not caught up with yet; after a pause mpv's own value counts again
  // (it may have changed elsewhere, e.g. keys in the external mpv window).
  const asked = useRef<{ subDelay?: Asked; speed?: Asked; volume?: Asked }>({});
  const base = (name: "subDelay" | "speed" | "volume") => {
    const last = asked.current[name];
    return last && Date.now() - last.at < CHAIN_MS ? last.value : latest.current[name];
  };
  const ask = (name: "subDelay" | "speed" | "volume", value: number) => {
    asked.current[name] = { value, at: Date.now() };
  };
  // a value mpv refused (external mpv's own volume-max below ours) is no base
  const forget = (name: "volume", value: number) => {
    if (asked.current[name]?.value === value) delete asked.current[name];
  };

  const togglePauseOrReplay = useCallback(() => {
    if (ended) {
      void playerCommand("seek", 0, "absolute").catch(() => undefined);
      void playerSetProperty("pause", false).catch(() => undefined);
    } else {
      void playerSetProperty("pause", !clock.get().pause).catch(() => undefined);
    }
    poke();
  }, [ended, clock, poke]);

  const seekBy = useCallback(
    (deltaSec: number) => {
      void playerCommand("seek", deltaSec, "relative").catch(() => undefined);
      poke();
    },
    [poke],
  );

  const changeVolume = useCallback(
    (delta: number) => {
      // (steps faster than mpv reports the volume build on each other, see `base`)
      const next = nextVolume(base("volume"), delta, ceiling.current);
      ask("volume", next);
      void playerSetProperty("volume", next).catch(() => forget("volume", next));
      if (latest.current.mute && delta > 0) {
        void playerSetProperty("mute", false).catch(() => undefined);
      }
      poke();
    },
    [poke],
  );

  const setVolume = useCallback(
    (value: number) => {
      ask("volume", value);
      void playerSetProperty("volume", value).catch(() => forget("volume", value));
      if (latest.current.mute) void playerSetProperty("mute", false).catch(() => undefined);
      poke();
    },
    [poke],
  );

  const toggleMute = useCallback(() => {
    void playerSetProperty("mute", !latest.current.mute).catch(() => undefined);
    poke();
  }, [poke]);

  const cycleSubtitles = useCallback(() => {
    void playerCommand("cycle", "sid").catch(() => undefined);
    poke();
  }, [poke]);

  const cycleSecondarySubtitles = useCallback(() => {
    void playerCommand("cycle", "secondary-sid").catch(() => undefined);
    poke();
  }, [poke]);

  const stepSubDelay = useCallback(
    (deltaSec: number) => {
      const next = Math.min(600, Math.max(-600, Math.round((base("subDelay") + deltaSec) * 1000) / 1000));
      ask("subDelay", next);
      void playerSetProperty("sub-delay", next).catch(() => undefined);
      poke();
    },
    [poke],
  );

  const stepSpeed = useCallback(
    (direction: 1 | -1) => {
      const next = nextSpeed(base("speed"), direction);
      ask("speed", next);
      void playerSetProperty("speed", next).catch(() => undefined);
      poke();
    },
    [poke],
  );

  return useMemo(
    () => ({
      togglePauseOrReplay,
      seekBy,
      changeVolume,
      setVolume,
      toggleMute,
      cycleSubtitles,
      cycleSecondarySubtitles,
      stepSubDelay,
      stepSpeed,
    }),
    [
      togglePauseOrReplay,
      seekBy,
      changeVolume,
      setVolume,
      toggleMute,
      cycleSubtitles,
      cycleSecondarySubtitles,
      stepSubDelay,
      stepSpeed,
    ],
  );
}

/**
 * Window-level shortcuts. `controls` is null while there is nothing to control (loading,
 * an error, mpv closed): then only `f` (when `onFullscreen` is given) and Escape work.
 * Escape calls `onBack` (the embedded screen's leaves fullscreen first, PlayerChrome).
 */
export function usePlayerKeys({
  controls,
  onFullscreen,
  onBack,
}: {
  controls: PlayerControls | null;
  onFullscreen: (() => void) | null;
  onBack: () => void;
}) {
  // live TV: nothing to seek in, no speed (the controls hide them too)
  const live = useLive();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      const ownsArrows =
        target instanceof HTMLInputElement &&
        target.type === "range" &&
        !target.hasAttribute(SEEK_SLIDER_ATTR);
      const typing =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "button");
      if (e.key === "Escape") {
        onBack();
        return;
      }
      // the focused volume slider moves itself with the arrow keys (and applies it);
      // on the seek bar, preventDefault below keeps its 0.1 s native step from running
      if (typing || (ownsArrows && e.key.startsWith("Arrow"))) return;
      if (e.key === "f" && onFullscreen) {
        onFullscreen();
        return;
      }
      if (!controls) return;
      if (live && ["ArrowLeft", "ArrowRight", "[", "]"].includes(e.key)) return;
      switch (e.key) {
        case " ":
          // no page scroll, and a button focused by an earlier click must not click again
          e.preventDefault();
          if (target instanceof HTMLButtonElement) target.blur();
          controls.togglePauseOrReplay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          controls.seekBy(-SEEK_STEP_SEC);
          break;
        case "ArrowRight":
          e.preventDefault();
          controls.seekBy(SEEK_STEP_SEC);
          break;
        case "ArrowUp":
          e.preventDefault();
          controls.changeVolume(VOLUME_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          controls.changeVolume(-VOLUME_STEP);
          break;
        case "m":
          controls.toggleMute();
          break;
        case "s":
          controls.cycleSubtitles();
          break;
        case "c":
          controls.cycleSecondarySubtitles();
          break;
        case "z":
          controls.stepSubDelay(-SUB_DELAY_STEP);
          break;
        case "x":
          controls.stepSubDelay(SUB_DELAY_STEP);
          break;
        case "[":
          controls.stepSpeed(-1);
          break;
        case "]":
          controls.stepSpeed(1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls, onFullscreen, onBack, live]);
}

/**
 * The mouse wheel over the player screen sets the volume (`controls` null: nothing to
 * control, the wheel does nothing). Not while one of the control bar's menus is open
 * (`PLAYER_MENU_ATTR`), nor over anything that scrolls itself, nor with Ctrl (pinch to
 * zoom on a trackpad) or Cmd. The wheel goes to the window under the pointer, focused
 * or not; over external mpv's own window mpv's own bindings apply.
 */
export function usePlayerWheel(controls: PlayerControls | null) {
  const state = useRef(WHEEL_IDLE);
  useEffect(() => {
    if (!controls) return;
    state.current = WHEEL_IDLE;
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
      if (document.querySelector(`[${PLAYER_MENU_ATTR}]`) || scrollsItself(e.target, e.deltaY)) return;
      // the page never scrolls; a step's wheel must not scroll anything under it either
      e.preventDefault();
      const legacy = e as WheelEvent & { wheelDeltaY?: number; webkitDirectionInvertedFromDevice?: boolean };
      const next = wheelStep(
        state.current,
        {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          wheelDeltaY: legacy.wheelDeltaY,
          inverted: legacy.webkitDirectionInvertedFromDevice,
        },
        e.timeStamp,
      );
      state.current = next.state;
      if (next.steps !== 0) controls.changeVolume(next.steps * VOLUME_STEP);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [controls]);
}

/** `target` is in something that can still scroll that way (an overlay's list). */
function scrollsItself(target: EventTarget | null, deltaY: number): boolean {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
      return true;
    }
  }
  return false;
}
