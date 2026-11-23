import { playerActive } from "./playback-handoff";

const DIRECTIONS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
} as const;

type Direction = keyof typeof DIRECTIONS;

const FOCUSABLE = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visible(element: HTMLElement): boolean {
  if (element.closest("[inert]") || element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function focusScope(): HTMLElement | Document {
  const dialogs = document.querySelectorAll<HTMLElement>(
    "dialog[open], [role='dialog'][aria-modal='true']",
  );
  return dialogs.item(dialogs.length - 1) ?? document;
}

function candidates(scope: HTMLElement | Document): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.tabIndex >= 0 && visible(element),
  );
}

function preferredFocus(): HTMLElement | null {
  const scope = focusScope();
  if (scope !== document) return candidates(scope)[0] ?? null;
  const available = candidates(scope);
  const content = available.find((element) => element.hasAttribute("data-tv-start"));
  if (content) return content;
  const current = document.querySelector<HTMLElement>(".app-sidebar [aria-current='page']");
  if (current && visible(current)) return current;
  return available[0] ?? null;
}

export function focusTvStart(preferContent = false) {
  const active = document.activeElement;
  if (
    preferContent &&
    active instanceof HTMLElement &&
    active.matches(".app-sidebar [aria-current='page']")
  ) {
    preferredFocus()?.focus({ preventScroll: true });
    return;
  }
  if (active instanceof HTMLElement && active !== document.body && visible(active)) return;
  preferredFocus()?.focus({ preventScroll: true });
}

function nearest(active: HTMLElement, direction: Direction, scope: HTMLElement | Document) {
  const [dx, dy] = DIRECTIONS[direction];
  const from = active.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const element of candidates(scope)) {
    if (element === active) continue;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = dx !== 0 ? (x - fromX) * dx : (y - fromY) * dy;
    if (primary <= 4) continue;

    const cross = dx !== 0 ? Math.abs(y - fromY) : Math.abs(x - fromX);
    const overlap =
      dx !== 0
        ? Math.min(from.bottom, rect.bottom) - Math.max(from.top, rect.top)
        : Math.min(from.right, rect.right) - Math.max(from.left, rect.left);
    const score = primary + cross * (overlap > 0 ? 1.5 : 3) + (overlap > 0 ? 0 : 400);
    if (score < bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

export function installTvNavigation(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      playerActive() ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !(event.key in DIRECTIONS)
    ) {
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (
      active?.matches("input, textarea, select, [contenteditable='true'], [role='slider']")
    ) {
      return;
    }

    event.preventDefault();
    const scope = focusScope();
    const next = active && visible(active) ? nearest(active, event.key as Direction, scope) : preferredFocus();
    if (!next) return;
    next.focus({ preventScroll: true });
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
