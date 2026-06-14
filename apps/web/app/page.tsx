import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { HeroDemo } from "@/components/HeroDemo";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* HERO */}
      <section className="grid items-center gap-12 py-16 md:grid-cols-[1.05fr_1fr] md:py-24">
        <div>
          <span className="ns-chip inline-block">Windows · 9×16 vertical capture</span>
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
            <Wordmark size={20} /> captures a crisp{" "}
            <b className="font-semibold text-ink">9×16</b> frame from your screen. Press
            Record, take five seconds to position and zoom, then save an encrypted
            recording you can preview in the app — and export to MP4 with Pro.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/download" className="ns-cta ns-cta--primary">
              Download free trial
            </Link>
            <Link href="/pricing" className="ns-cta ns-cta--ghost">
              Purchase for $49
            </Link>
          </div>
          <p className="mt-5 font-mono text-xs text-inkfaint">
            Record &amp; preview free · Pro unlocks export · No account required to try
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
            kicker="Built for vertical"
            title="Short-form, tutorials, and polished."
          />
          <p className="max-w-sm font-body text-sm text-inksoft">
            One native app. One framing workflow. Output that already fits the platforms you
            publish to.
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
          title="Precise capture. Nothing extra."
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
              Frame in five seconds. Record with confidence.
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
            Download free on Windows. Record and preview forever. Buy Pro once ($49) when
            you need to export MP4 files from the app.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/download" className="ns-cta ns-cta--accent">
              Get the app
            </Link>
            <Link href="/sign-up" className="ns-cta ns-cta--ghost">
              Create account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const STATS = [
  { value: "9×16", label: "Portrait output" },
  { value: "5s", label: "Framing countdown" },
  { value: "60fps", label: "Up to 1080p" },
  { value: "Local", label: "Encrypted on disk" },
];

const USE_CASES = [
  { icon: "📱", title: "Shorts & Reels", desc: "Vertical canvas from day one — no crop step in post." },
  { icon: "💻", title: "Tutorials", desc: "Follow the cursor while keeping the frame tight on your UI." },
  { icon: "🎚️", title: "Voice & system audio", desc: "Capture mic, desktop audio, or both with level meters before you roll." },
  { icon: "🔒", title: "Private by default", desc: "Recordings stay on your machine until you export them." },
];

const FEATURES = [
  {
    icon: "▯",
    title: "9×16 vertical capture",
    desc: "Every recording is portrait-native — built for Shorts, Reels, and TikTok.",
  },
  {
    icon: "◎",
    title: "Cursor-driven framing",
    desc: "Move the mouse to position the frame. Hold Alt + scroll to zoom from full desktop down to a tight crop.",
  },
  {
    icon: "🎚️",
    title: "System & mic audio",
    desc: "Capture system audio, microphone, or both with gain meters and a quick level check before you roll.",
  },
  {
    icon: "🪶",
    title: "Native & lightweight",
    desc: "Tauri on Windows Graphics Capture — low overhead, no bloated Electron shell.",
  },
  {
    icon: "📤",
    title: "Export to MP4",
    desc: "Unlock Pro to export decrypted MP4 files straight to your computer or Google Drive.",
  },
  {
    icon: "💾",
    title: "Encrypted local files",
    desc: "Recordings save as encrypted .ns files on disk. Preview in-app; export decrypted MP4 with Pro.",
  },
];

const STEPS = [
  {
    title: "Press Record",
    desc: "Hit the record button in Studio. The app minimizes and gives you a live framing overlay on your desktop.",
    points: ["5-second countdown before capture starts", "Cancel anytime during the countdown"],
  },
  {
    title: "Frame the shot",
    desc: "Position the 9×16 viewport with your cursor. Zoom with Alt + scroll — snap to full frame when you need precision.",
    points: ["Rule-of-thirds guides on the overlay", "Show or hide the frame before you roll"],
  },
  {
    title: "Save & preview",
    desc: "Capture encrypted video locally, preview it in-app, and export MP4 with Pro when you are ready.",
    points: ["Up to 1080p · 30 or 60 fps", "Export MP4 anywhere with Pro"],
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
