import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { HeroDemo } from "@/components/HeroDemo";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* HERO */}
      <section className="grid items-center gap-10 py-14 md:grid-cols-[1.05fr_1fr] md:py-20">
        <div>
          <span className="ns-chip inline-block">Desktop recorder &amp; live streamer</span>
          <h1 className="mt-5 font-display text-5xl leading-[1.05] sm:text-6xl">
            Record &amp; stream,
            <br />
            framed by{" "}
            <span className="relative whitespace-nowrap text-bluedeep">
              hand
              <span className="absolute -bottom-1 left-0 h-2 w-full -skew-x-6 bg-yellow" />
            </span>
            .
          </h1>
          <p className="mt-6 max-w-md font-body text-lg text-inksoft">
            <Wordmark size={20} /> is a lightweight desktop capture tool with a tactile,
            two-handed framing viewport. Shoot in <b className="text-ink">16×9</b> or{" "}
            <b className="text-ink">9×16</b> and pan, zoom &amp; rotate the frame live with your
            other hand.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/download"
              className="rounded-full border-2 border-ink bg-blue px-6 py-3 font-display text-lg shadow-[5px_5px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              Download free
            </Link>
            <Link
              href="/pricing"
              className="rounded-full border-2 border-ink bg-surface px-6 py-3 font-display text-lg shadow-[5px_5px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-4 font-mono text-xs text-inkfaint">
            Free while in beta · Windows · no credit card
          </p>
        </div>

        <div className="ns-float">
          <HeroDemo />
        </div>
      </section>

      {/* ASPECT STRIP */}
      <section className="grid gap-4 py-6 sm:grid-cols-2">
        <AspectCard
          label="16×9"
          title="Widescreen"
          desc="Tutorials, gameplay, talking-head — the classic landscape canvas."
          ratio="16 / 9"
        />
        <AspectCard
          label="9×16"
          title="Vertical"
          desc="Shorts, Reels, TikTok — born-vertical, not letterboxed."
          ratio="9 / 16"
          accent="pink"
        />
      </section>

      {/* FEATURES */}
      <section id="features" className="py-16">
        <SectionHeading kicker="What it does" title="Everything a creator needs, nothing they don't." />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="ns-card p-6">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border-2 border-ink bg-bg text-2xl">
                {f.icon}
              </div>
              <h3 className="font-display text-xl">{f.title}</h3>
              <p className="mt-2 font-body text-sm text-inksoft">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TWO-HANDED */}
      <section id="two-handed" className="py-16">
        <div className="ns-card overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[1fr_1.1fr]">
            <div className="border-b-2 border-ink p-8 md:border-b-0 md:border-r-2">
              <span className="ns-chip">The unique part</span>
              <h2 className="mt-4 font-display text-3xl leading-tight">
                Your non-dominant hand becomes the camera operator.
              </h2>
              <p className="mt-4 font-body text-inksoft">
                Plug in a second mouse (or any input device). It never touches your cursor —
                instead it drives the framing viewport, so you can keep working with your main
                hand while you direct the shot with the other.
              </p>
              <ul className="mt-6 space-y-3">
                {CONTROLS.map((c) => (
                  <li key={c.k} className="flex items-center gap-3">
                    <kbd className="rounded-md border-2 border-ink bg-bg px-2.5 py-1 font-mono text-xs shadow-[2px_2px_0_var(--color-ink)]">
                      {c.k}
                    </kbd>
                    <span className="font-body text-sm text-ink">{c.v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-bgalt p-8">
              <HandDiagram />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="ns-card flex flex-col items-center gap-5 bg-surface px-6 py-12 text-center">
          <Wordmark size={44} showSuffix />
          <p className="max-w-md font-body text-inksoft">
            Download the free beta and start framing your desktop with both hands.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/download"
              className="rounded-full border-2 border-ink bg-pink px-6 py-3 font-display text-lg shadow-[5px_5px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              Download for Windows
            </Link>
            <Link
              href="/sign-up"
              className="rounded-full border-2 border-ink bg-surface px-6 py-3 font-display text-lg shadow-[5px_5px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const FEATURES = [
  { icon: "🎞️", title: "16×9 & 9×16 capture", desc: "Switch the canvas between widescreen and vertical instantly — no re-cropping later." },
  { icon: "🖐️", title: "Two-handed framing", desc: "A second input device pans, zooms and rotates the viewport while you keep working." },
  { icon: "🪶", title: "Lightweight & native", desc: "A tiny Tauri app using native Windows capture — low CPU, no bloated Electron." },
  { icon: "💾", title: "Local-first storage", desc: "Recordings save straight to your disk. Your footage never leaves your machine." },
  { icon: "📡", title: "Live streaming ready", desc: "Stream the framed output to your platform of choice (rolling out in beta)." },
  { icon: "🎛️", title: "Buttery-smooth motion", desc: "Pan, zoom and rotation are interpolated for silky, broadcast-quality moves." },
];

const CONTROLS = [
  { k: "2nd mouse move", v: "Pan the framing viewport" },
  { k: "Scroll wheel", v: "Zoom the viewport in / out" },
  { k: "Side button", v: "Rotate between 9×16 ⇄ 16×9" },
  { k: "Press R", v: "Quick orientation flip" },
];

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="max-w-2xl">
      <span className="ns-chip">{kicker}</span>
      <h2 className="mt-4 font-display text-3xl leading-tight sm:text-4xl">{title}</h2>
    </div>
  );
}

function AspectCard({
  label,
  title,
  desc,
  ratio,
  accent = "blue",
}: {
  label: string;
  title: string;
  desc: string;
  ratio: string;
  accent?: "blue" | "pink";
}) {
  return (
    <div className="ns-card flex items-center gap-5 p-5">
      <div
        className="grid shrink-0 place-items-center rounded-lg border-2 border-ink"
        style={{
          aspectRatio: ratio,
          width: ratio === "16 / 9" ? 110 : 56,
          background: accent === "blue" ? "var(--color-blue)" : "var(--color-pink)",
        }}
      >
        <span className="font-display text-sm text-ink">{label}</span>
      </div>
      <div>
        <h3 className="font-display text-xl">{title}</h3>
        <p className="mt-1 font-body text-sm text-inksoft">{desc}</p>
      </div>
    </div>
  );
}

function HandDiagram() {
  return (
    <div className="grid h-full grid-cols-2 gap-4">
      <div className="ns-card flex flex-col items-center justify-center gap-2 bg-surface p-5 text-center">
        <span className="text-4xl">🖱️</span>
        <span className="font-display text-sm">Main hand</span>
        <span className="font-mono text-[11px] text-inksoft">work as usual</span>
      </div>
      <div className="ns-card flex flex-col items-center justify-center gap-2 bg-blue/30 p-5 text-center">
        <span className="text-4xl">🤚</span>
        <span className="font-display text-sm">Other hand</span>
        <span className="font-mono text-[11px] text-inksoft">drive the frame</span>
      </div>
      <div className="col-span-2 ns-card flex items-center justify-around bg-surface p-4 font-mono text-[11px] text-inksoft">
        <span>pan ⇄</span>
        <span>zoom ⊕⊖</span>
        <span>rotate ↻</span>
      </div>
    </div>
  );
}
