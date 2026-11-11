import { Download } from "lucide-react";
import zeilerLogo from "../assets/zeiler-logo-white.png";

/** Production browsers get the installable shell without calling unavailable native APIs. */
export function WebShell() {
  return (
    <main className="min-h-full overflow-y-auto bg-canvas text-ink">
      <header className="flex h-20 items-center gap-3 px-5 sm:px-10">
        <img src={zeilerLogo} alt="" className="h-10 w-10" />
        <span className="font-display text-[28px] font-medium tracking-tight">Zeiler</span>
      </header>
      <section className="mx-auto flex min-h-[calc(100svh-5rem)] max-w-2xl flex-col items-start justify-center px-6 pb-24 sm:px-10">
        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">
          Zeiler on the web
        </div>
        <h1 className="mt-4 font-display text-[44px] font-medium leading-[1.02] tracking-tight sm:text-[60px]">
          The responsive shell is ready.
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-muted">
          Install Zeiler after your first visit and the web shell works offline. In this release,
          catalogs, accounts, and playback still require the desktop app.
        </p>
        <a
          href="https://zeiler.io"
          className="button-primary mt-8"
        >
          <Download size={17} />
          Get Zeiler desktop
        </a>
        <p className="mt-5 text-[12px] text-ink-subtle">Windows · macOS · Linux</p>
      </section>
    </main>
  );
}
