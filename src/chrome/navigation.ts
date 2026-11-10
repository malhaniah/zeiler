import {
  Blocks,
  Compass,
  Film,
  Home,
  Library,
  Radio,
  Settings,
  Sparkles,
  Tv,
} from "lucide-react";
import type { RootView } from "../lib/view";

export interface NavEntry {
  view: RootView;
  label: string;
  icon: typeof Home;
}

export function primaryNavigation(hideAnime = false, hideLiveTv = false): NavEntry[] {
  return [
    { view: "home", label: "Home", icon: Home },
    { view: "discover", label: "Discover", icon: Compass },
    { view: "movies", label: "Movies", icon: Film },
    { view: "shows", label: "Shows", icon: Tv },
    ...(hideAnime ? [] : [{ view: "anime" as const, label: "Anime", icon: Sparkles }]),
    ...(hideLiveTv ? [] : [{ view: "live" as const, label: "Live TV", icon: Radio }]),
    { view: "library", label: "My Library", icon: Library },
  ];
}

export const secondaryNavigation: NavEntry[] = [
  { view: "addons", label: "Addons", icon: Blocks },
  { view: "settings", label: "Settings", icon: Settings },
];
