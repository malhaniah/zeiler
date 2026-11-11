import { Info, Play, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MetaPreview } from "../lib/types";
import { fallbackGradient } from "./Poster";

/**
 * Harbor-style hero carousel. `card` = Home's rounded 560px billboard;
 * `bleed` = the Movies room's full-bleed 78vh cinema hero.
 */
export function HeroCarousel({
  items,
  variant = "card",
  typeLabel,
  onOpen,
  autoMs = 13000,
}: {
  items: MetaPreview[];
  variant?: "card" | "bleed";
  typeLabel: string;
  onOpen: (meta: MetaPreview) => void;
  autoMs?: number;
}) {
  const [active, setActive] = useState(0);
  const hovered = useRef(false);

  useEffect(() => {
    if (items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (!hovered.current && !document.hidden) {
        setActive((a) => (a + 1) % items.length);
      }
    }, autoMs);
    return () => clearInterval(timer);
  }, [items.length, autoMs]);

  if (items.length === 0) {
    return (
      <div
        className={
          variant === "card"
            ? "min-h-[560px] animate-pulse rounded-[28px] border border-edge-soft bg-elevated/30"
            : "h-[76svh] min-h-[540px] animate-pulse bg-elevated/30 sm:h-[78vh] sm:min-h-[640px]"
        }
      />
    );
  }

  const shell =
    variant === "card"
      ? "group relative h-[560px] cursor-pointer overflow-hidden rounded-[28px] bg-canvas"
      : "group relative h-[76svh] min-h-[540px] cursor-pointer overflow-hidden bg-canvas sm:h-[78vh] sm:min-h-[640px]";

  return (
    <div className="flex flex-col gap-4">
      <section
        className={shell}
        style={{ isolation: "isolate" }}
        onMouseEnter={() => (hovered.current = true)}
        onMouseLeave={() => (hovered.current = false)}
        onClick={() => onOpen(items[active])}
      >
        {items.map((meta, i) => (
          <Slide key={meta.id} meta={meta} active={i === active} variant={variant} rank={i + 1} typeLabel={typeLabel} onOpen={onOpen} />
        ))}
      </section>
      {items.length > 1 && (
        <div className={`flex justify-center gap-2.5 ${variant === "bleed" ? "-mt-12 relative z-10 pb-2" : "pt-1"}`}>
          {items.map((_, i) => (
            <button
              key={i}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setActive(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? "w-12 bg-ink" : "w-6 bg-ink-muted/70 hover:bg-ink-muted"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Slide({
  meta,
  active,
  variant,
  rank,
  typeLabel,
  onOpen,
}: {
  meta: MetaPreview;
  active: boolean;
  variant: "card" | "bleed";
  rank: number;
  typeLabel: string;
  onOpen: (meta: MetaPreview) => void;
}) {
  const [logoOk, setLogoOk] = useState(true);
  const art = meta.background ?? meta.poster;
  return (
    <div
      className={`absolute transition-opacity duration-700 ease-[cubic-bezier(0.32,0.72,0.24,1)] ${
        variant === "card" ? "inset-[2px] rounded-[26px] overflow-hidden" : "inset-0"
      } ${active ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      {art ? (
        <img
          src={art}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover opacity-90 transition-transform duration-[1200ms] ${
            active ? "scale-100" : "scale-[1.04]"
          }`}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: fallbackGradient(meta.id) }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/85 via-50% to-transparent" />
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-canvas via-canvas/70 via-50% to-transparent ${
          variant === "card" ? "h-2/5" : "h-2/3 sm:h-2/5"
        }`}
      />

      <div
        className={`relative flex h-full flex-col justify-center ${
          variant === "card"
            ? "p-14"
            : "justify-end px-5 pb-16 sm:px-12 sm:pb-20 lg:px-20 lg:pb-24"
        }`}
      >
        <div
          className={`max-w-2xl transition-[opacity,transform] delay-100 duration-700 ease-out ${
            active ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
          }`}
        >
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-md bg-canvas/85 px-2.5 py-1 text-[11px] font-semibold text-ink sm:mb-5 sm:text-[12px]">
            <TrendingUp size={13} className="text-accent" />
            #{rank} in {typeLabel} Today
          </div>
          <div className="flex min-h-[88px] items-end sm:min-h-[112px]">
            {meta.logo && logoOk ? (
              <img
                src={meta.logo}
                alt={meta.name}
                onError={() => setLogoOk(false)}
                className="max-h-[88px] max-w-[85%] object-contain object-left drop-shadow-[0_6px_22px_rgba(0,0,0,0.45)] sm:max-h-[120px] sm:max-w-[460px]"
              />
            ) : (
              <h1 className="font-display text-[42px] font-medium leading-[0.98] tracking-tight text-ink sm:text-[56px] lg:text-[68px]">
                {meta.name}
              </h1>
            )}
          </div>
          {meta.description && (
            <p className="mt-4 line-clamp-2 max-w-xl text-[14px] leading-relaxed text-ink-muted sm:mt-6 sm:line-clamp-3 sm:text-[16px]">
              {meta.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[12px] sm:mt-6 sm:gap-x-8 sm:text-[14px]">
            {meta.releaseInfo && (
              <span>
                <span className="text-ink-subtle">Year: </span>
                <span className="text-ink">{meta.releaseInfo}</span>
              </span>
            )}
            {meta.imdbRating && (
              <span className="flex items-center gap-1.5">
                <span className="rounded-[3px] bg-[#f5c518] px-1 text-[10px] font-bold text-black">
                  IMDb
                </span>
                <span className="text-ink">{meta.imdbRating}</span>
              </span>
            )}
            {meta.genres.length > 0 && (
              <span className="text-ink-subtle">{meta.genres.slice(0, 3).join(" · ")}</span>
            )}
          </div>
          <div className="mt-6 flex gap-3 sm:mt-9">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(meta);
              }}
              className="button-primary"
            >
              <Play size={17} fill="currentColor" />
              Play
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(meta);
              }}
              className="flex h-12 items-center gap-2 rounded-lg border border-edge bg-surface/85 px-6 text-[15px] font-semibold text-ink transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-ink-subtle hover:bg-elevated active:translate-y-0"
            >
              <Info size={16} />
              More info
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
