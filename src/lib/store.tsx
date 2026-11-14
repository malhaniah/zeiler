import { listen } from "@tauri-apps/api/event";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ADDONS_CHANGED,
  SETTINGS_CHANGED,
  addonList,
  errorMessage,
  settingsGet,
  settingsPatch,
} from "./ipc";
import { applyTheme } from "./theme";
import type { Descriptor, Settings, SettingsPatch } from "./types";

// ---- addons ---------------------------------------------------------------------------

interface AddonsCtx {
  addons: Descriptor[];
  loaded: boolean;
  reload: () => Promise<void>;
}

const AddonsContext = createContext<AddonsCtx>({
  addons: [],
  loaded: false,
  reload: async () => {},
});

export const useAddons = () => useContext(AddonsContext);

// ---- settings -------------------------------------------------------------------------

interface SettingsCtx {
  settings: Settings | null;
  /**
   * Optimistically applies `patch`, then sends only its keys to Rust (`settings_patch`,
   * merged server-side so concurrent writers never undo each other; a group such as
   * `subtitles` is merged field by field). Writes from this provider are serialized and
   * pending edits are reapplied to each result, so a failure or stale response cannot
   * erase a newer edit. Every change, from anywhere, arrives via `settings://changed`.
   */
  save: (patch: SettingsPatch) => Promise<void>;
}

const SettingsContext = createContext<SettingsCtx>({
  settings: null,
  save: async () => {},
});

export const useSettings = () => useContext(SettingsContext);

/** `patch` merged into `base` the way `settings_patch` merges it: objects key by key,
 * arrays and scalars replaced. */
function mergePatch(base: unknown, patch: unknown): unknown {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObject(base) || !isObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = mergePatch(base[key], value);
  }
  return out;
}

// ---- search overlay -------------------------------------------------------------------

interface SearchCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SearchContext = createContext<SearchCtx>({ open: false, setOpen: () => {} });
export const useSearch = () => useContext(SearchContext);

// ---- combined provider ----------------------------------------------------------------

export function StoreProvider({ children }: { children: ReactNode }) {
  const [addons, setAddons] = useState<Descriptor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsRetrying, setSettingsRetrying] = useState(false);
  // latest settings for save(), which must not close over a stale render
  const settingsRef = useRef<Settings | null>(null);
  const authoritativeRef = useRef<Settings | null>(null);
  const pendingRef = useRef<{ id: number; patch: SettingsPatch }[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nextSaveRef = useRef(0);
  const settingsVersionRef = useRef(0);
  const settingsRequestRef = useRef(0);
  const addonRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const setSettings = useCallback((next: Settings) => {
    if (!mountedRef.current) return;
    settingsRef.current = next;
    setSettingsState(next);
    applyTheme(next.theme);
  }, []);

  const showPending = useCallback(
    (base: Settings) => {
      let next: unknown = base;
      for (const operation of pendingRef.current) {
        next = mergePatch(next, operation.patch);
      }
      setSettings(next as Settings);
    },
    [setSettings],
  );

  const receiveSettings = useCallback(
    (next: Settings) => {
      authoritativeRef.current = next;
      settingsVersionRef.current += 1;
      if (mountedRef.current) setSettingsError(null);
      showPending(next);
    },
    [showPending],
  );

  const loadSettings = useCallback(async () => {
    const id = ++settingsRequestRef.current;
    const version = settingsVersionRef.current;
    setSettingsRetrying(true);
    try {
      const next = await settingsGet();
      if (id !== settingsRequestRef.current) return;
      if (settingsVersionRef.current === version) receiveSettings(next);
      setSettingsError(null);
    } catch (e) {
      if (id === settingsRequestRef.current && !settingsRef.current) {
        setSettingsError(errorMessage(e));
      }
    } finally {
      if (id === settingsRequestRef.current) setSettingsRetrying(false);
    }
  }, [receiveSettings]);

  const reload = useCallback(async () => {
    const id = ++addonRequestRef.current;
    try {
      const next = await addonList();
      if (mountedRef.current && id === addonRequestRef.current) setAddons(next);
    } catch {
      // Keep the last working list; a refresh failure must not fail the action that caused it.
    } finally {
      if (mountedRef.current && id === addonRequestRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    void loadSettings();
    const unlisten = listen<Settings>(SETTINGS_CHANGED, (e) => receiveSettings(e.payload));
    // an account sync replaced the profile's addons
    const unlistenAddons = listen(ADDONS_CHANGED, () => void reload());
    return () => {
      mountedRef.current = false;
      settingsRequestRef.current += 1;
      addonRequestRef.current += 1;
      void unlisten.then((off) => off());
      void unlistenAddons.then((off) => off());
    };
  }, [loadSettings, receiveSettings, reload]);

  const save = useCallback(
    (patch: SettingsPatch): Promise<void> => {
      const current = settingsRef.current;
      if (!current) return Promise.resolve();
      const keys = (Object.keys(patch) as (keyof Settings)[]).filter(
        (k) => patch[k] !== undefined,
      );
      if (keys.length === 0) return Promise.resolve();
      const changed: SettingsPatch = {};
      for (const k of keys) Object.assign(changed, { [k]: patch[k] });
      const operation = { id: ++nextSaveRef.current, patch: changed };
      pendingRef.current.push(operation);
      setSettings(mergePatch(current, changed) as Settings); // optimistic

      const run = async () => {
        const version = settingsVersionRef.current;
        try {
          const next = await settingsPatch(changed);
          // An event may already carry this write or a newer external one.
          if (settingsVersionRef.current === version) {
            authoritativeRef.current = next;
            settingsVersionRef.current += 1;
          }
        } catch {
          // Removing this operation below rolls it back without touching later edits.
        }
        pendingRef.current = pendingRef.current.filter((op) => op.id !== operation.id);
        showPending(authoritativeRef.current ?? current);
      };
      const result = saveQueueRef.current.then(run, run);
      saveQueueRef.current = result;
      return result;
    },
    [setSettings, showPending],
  );

  return (
    <AddonsContext.Provider value={{ addons, loaded, reload }}>
      <SettingsContext.Provider value={{ settings, save }}>
        <SearchContext.Provider value={{ open: searchOpen, setOpen: setSearchOpen }}>
          <div className="contents" inert={settingsError !== null}>
            {children}
          </div>
          {settingsError && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-load-error-title"
              aria-describedby="settings-load-error-description"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className="fixed inset-0 z-[200] flex items-center justify-center bg-canvas/95 p-6"
            >
              <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-edge-soft bg-elevated p-7 shadow-2xl">
                <h2 id="settings-load-error-title" className="text-[20px] font-medium text-ink">
                  Couldn't load settings
                </h2>
                <p
                  id="settings-load-error-description"
                  aria-live="polite"
                  className="text-[14px] leading-relaxed text-ink-muted"
                >
                  Zeiler couldn't read this profile's settings. Your navigation is still here;
                  retry to continue. {settingsError}
                </p>
                <button
                  type="button"
                  autoFocus
                  disabled={settingsRetrying}
                  onClick={() => void loadSettings()}
                  className="mt-2 flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-[13.5px] font-semibold text-canvas disabled:opacity-50"
                >
                  {settingsRetrying ? "Retrying…" : "Retry"}
                </button>
              </div>
            </div>
          )}
        </SearchContext.Provider>
      </SettingsContext.Provider>
    </AddonsContext.Provider>
  );
}
