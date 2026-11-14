// Local profiles: who is watching. The shell below this provider is keyed by the
// active profile, so switching remounts it and every store reads the new profile's
// addons, settings and library from scratch.
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
import { PROFILES_CHANGED, errorMessage, profileList, profileSelect } from "./ipc";
import type { ProfilesState } from "./types";

interface ProfilesCtx {
  state: ProfilesState | null;
  error: string | null;
  reload: () => Promise<void>;
  select: (id: string, pin?: string) => Promise<void>;
  /** the picker is showing ("Who's watching?") */
  picking: boolean;
  setPicking: (open: boolean) => void;
}

const ProfilesContext = createContext<ProfilesCtx>({
  state: null,
  error: null,
  reload: async () => {},
  select: async () => {},
  picking: false,
  setPicking: () => {},
});

export const useProfiles = () => useContext(ProfilesContext);

/** `children` gets the active profile's id, and whether it may be used (its PIN was
 * entered, or it has none). While it may not, nothing of it should be mounted. */
export function ProfilesProvider({
  children,
}: {
  children: (activeId: string | null, unlocked: boolean) => ReactNode;
}) {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // the shell waits for the first answer, so it mounts once, for the right profile
  const [ready, setReady] = useState(false);
  const request = useRef(0);
  const initialized = useRef(false);

  const accept = useCallback((next: ProfilesState) => {
    setState(next);
    setError(null);
    if (!initialized.current) {
      initialized.current = true;
      // at launch: more than one profile, or the active one has a PIN
      if (next.profiles.length > 1 || !next.unlocked) setPicking(true);
    }
  }, []);

  const reload = useCallback(async () => {
    const mine = ++request.current;
    try {
      const next = await profileList();
      if (mine !== request.current) return;
      setReady(true);
      accept(next);
    } catch (e) {
      if (mine !== request.current) return;
      setError(errorMessage(e));
      setReady(true);
    }
  }, [accept]);

  const select = useCallback(
    async (id: string, pin?: string) => {
      const mine = ++request.current;
      const next = await profileSelect(id, pin);
      // Usually the change event has already supplied this state. If it has not, the
      // command's answer still unlocks and switches the shell; a newer event wins.
      if (mine === request.current) accept(next);
    },
    [accept],
  );

  useEffect(() => {
    void reload();
    const unlisten = listen<ProfilesState>(PROFILES_CHANGED, (e) => {
      request.current++;
      setReady(true);
      accept(e.payload);
    });
    return () => {
      request.current++;
      void unlisten.then((off) => off());
    };
  }, [accept, reload]);

  return (
    <ProfilesContext.Provider value={{ state, error, reload, select, picking, setPicking }}>
      {ready && children(state?.activeId ?? null, state?.unlocked ?? false)}
    </ProfilesContext.Provider>
  );
}
