import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { HeroDemo } from "@/components/HeroDemo";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* HERO */}
      <section className="grid items-center gap-12 py-16 md:grid-cols-[1.05fr_1fr] md:py-24">
        <div>
          <span className="ns-chip inline-block">Windows · vertical screen recorder</span>
          <h1 className="mt-6 font-display text-[2.75rem] leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.25rem]">
            Your desktop,
            <br />
            shot{" "}
            <span className="relative whitespace-nowrap text-pinkdeep">
              vertical
              <span className="absolute -bottom-1 left-0 h-2.5 w-full -skew-x-6 bg-yellow" />
            </span>
            .
          </h1>
          <p className="mt-6 max-w-lg font-body text-lg leading-relaxed text-inksoft">
            <Wordmark size={20} /> records your screen in true{" "}
            <b className="font-semibold text-ink">9×16</b> — no cropping, no reframing
            in post. Follow your cursor, zoom with Alt + scroll, and walk away with
            short-form footage that drops straight into CapCut, Premiere, or your editor
            of choice.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/download" className="ns-cta ns-cta--primary">
              Download free
            </Link>
            <Link href="/pricing" className="ns-cta ns-cta--ghost">
              Unlock Pro · $49
            </Link>
          </div>
          <p className="mt-5 font-mono text-xs text-inkfaint">
            Record &amp; preview free · $49 one-time to export · No account to start
          </p>
        </div>

        <div className="ns-float">
          <HeroDemo />
        </div>
      </section>

      {/* STATS */}
      <section className="ns-stats-row py-4">
        {STATS.map((s) => (
          <div key={s.label} className="ns-stat">
            <span className="ns-stat-value">{s.value}</span>
            <span className="ns-stat-label">{s.label}</span>
          </div>
        ))}
      </section>

      {/* USE CASES */}
      <section className="py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            kicker="Who it's for"
            title="Made for people who film their screen."
          />
          <p className="max-w-sm font-body text-sm text-inksoft">
            If your content lives on a phone screen, your recordings should too. One app, one
            framing workflow, and output that already fits where you publish.
          </p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((u) => (
            <div key={u.title} className="ns-card ns-card--flat p-5">
              <span className="text-2xl">{u.icon}</span>
              <h3 className="mt-3 font-display text-lg">{u.title}</h3>
              <p className="mt-1.5 font-body text-sm text-inksoft">{u.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-16">
        <SectionHeading
          kicker="What you get"
          title="Everything to shoot vertical. Nothing you don't."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="ns-card p-6">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border-2 border-ink bg-bgalt text-xl">
                {f.icon}
              </div>
              <h3 className="font-display text-xl">{f.title}</h3>
              <p className="mt-2 font-body text-sm leading-relaxed text-inksoft">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-16">
        <div className="ns-card overflow-hidden">
          <div className="border-b-2 border-ink bg-bgalt px-8 py-6 md:px-10">
            <span className="ns-chip">How it works</span>
            <h2 className="mt-4 max-w-xl font-display text-3xl leading-tight sm:text-4xl">
              Three steps from blank screen to ready-to-edit clip.
            </h2>
          </div>
          <div className="grid gap-0 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div
                key={step.title}
                className={`p-8 md:p-9 ${i < STEPS.length - 1 ? "md:border-r-2 md:border-ink" : ""} ${i > 0 ? "border-t-2 border-ink md:border-t-0" : ""}`}
              >
                <span className="font-mono text-xs text-inkfaint">0{i + 1}</span>
                <h3 className="mt-3 font-display text-xl">{step.title}</h3>
                <p className="mt-3 font-body text-sm leading-relaxed text-inksoft">
                  {step.desc}
                </p>
                <ul className="mt-4 space-y-2">
                  {step.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 font-mono text-[11px] text-ink">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pink" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 pb-24">
        <div className="ns-card ns-cta-panel flex flex-col items-center gap-6 px-6 py-14 text-center md:px-12 md:py-16">
          <Wordmark size={48} showSuffix />
          <p className="max-w-lg font-body text-lg text-inksoft">
            Record and preview free, forever. Unlock unlimited MP4 export with a single $49
            payment — no subscription, no watermark, no catch.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/download" className="ns-cta ns-cta--accent">
              Download free
            </Link>
            <Link href="/pricing" className="ns-cta ns-cta--ghost">
              Unlock Pro · $49
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const STATS = [
  { value: "9×16", label: "Native portrait capture" },
  { value: "0", label: "Crop steps in post" },
  { value: "1080p", label: "Up to 60fps" },
  { value: "$49", label: "One-time, no subscription" },
];

const USE_CASES = [
  { icon: "📱", title: "Shorts, Reels & TikTok", desc: "Vertical from frame one. Publish clips with no crop step and no black bars." },
  { icon: "🚀", title: "Demos & build-in-public", desc: "Show your app tight and vertical — the perfect launch and progress clips for founders and indie hackers." },
  { icon: "🎓", title: "Tutorials & courses", desc: "Keep the frame locked on the UI that matters while the viewport follows your cursor." },
  { icon: "🎮", title: "Walkthroughs & reviews", desc: "Capture software, tools, and gameplay in portrait with system audio and your voice." },
];

const FEATURES = [
  {
    icon: "▯",
    title: "True 9×16 capture",
    desc: "Record portrait-native. What you frame is exactly what exports — zero letterboxing, zero cropping later.",
  },
  {
    icon: "◎",
    title: "Cursor-driven framing",
    desc: "The frame follows your mouse. Hold Alt + scroll to glide from full desktop into a tight, intentional crop — live, as you record.",
  },
  {
    icon: "🎚️",
    title: "System + mic audio",
    desc: "Blend desktop sound and your microphone with gain meters and a one-tap level check before you roll.",
  },
  {
    icon: "🪶",
    title: "Native & featherlight",
    desc: "Built on Windows Graphics Capture, not a heavy Electron shell. Buttery capture, low CPU, no fan spin-up.",
  },
  {
    icon: "📤",
    title: "Export-ready MP4",
    desc: "Unlock Pro to export clean MP4s to your disk or Google Drive — ready for CapCut, Premiere, or straight to upload.",
  },
  {
    icon: "🔒",
    title: "Private & local-first",
    desc: "Recordings are encrypted on your own machine. Nothing leaves your disk until you choose to export.",
  },
];

const STEPS = [
  {
    title: "Hit Record",
    desc: "Press record in Studio. The app slips out of the way and drops a live 9×16 overlay onto your desktop.",
    points: ["5-second countdown so you can get set", "Cancel anytime before capture starts"],
  },
  {
    title: "Frame as you go",
    desc: "Steer the viewport with your cursor and zoom with Alt + scroll. Rule-of-thirds guides keep every shot composed.",
    points: ["Snap to full 9×16 for precision", "Reframe live, mid-recording"],
  },
  {
    title: "Save & export",
    desc: "Stop and your clip saves encrypted, ready to preview in-app. Export to MP4 with Pro whenever you want.",
    points: ["Up to 1080p · 30 or 60 fps", "Drops straight into your editor"],
  },
];

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="max-w-2xl">
      <span className="ns-chip">{kicker}</span>
      <h2 className="mt-4 font-display text-3xl leading-tight tracking-tight sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}
