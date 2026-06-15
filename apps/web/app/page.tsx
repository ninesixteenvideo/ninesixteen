import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { FeaturesGrid, StepsGrid, UseCasesGrid } from "@/components/LandingCardSections";
import { HeroVideo } from "@/components/HeroVideo";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* HERO */}
      <section className="grid items-center gap-12 py-16 md:grid-cols-[1.05fr_1fr] md:py-24">
        <div>
          <span className="ns-chip inline-block">Windows · vertical screen recorder</span>
          <h1 className="mt-6 font-display text-[2.75rem] leading-[1.02] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]">
            Your desktop,
            <br />
            shot vertical.
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
            <Link href="/pricing" className="ns-cta ns-cta--accent">
              Purchase · $49
            </Link>
          </div>
          <p className="mt-5 font-mono text-xs text-inkfaint">
            Record &amp; preview free · $49 one-time to export · No account to start
          </p>
        </div>

        <div className="flex justify-center">
          <HeroVideo />
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
        <UseCasesGrid />
      </section>

      {/* FEATURES */}
      <section id="features" className="py-16">
        <SectionHeading
          kicker="What you get"
          title="Everything to shoot vertical. Nothing you don't."
        />
        <FeaturesGrid />
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-16">
        <SectionHeading
          kicker="How it works"
          title="Three steps from blank screen to ready-to-edit clip."
        />
        <StepsGrid />
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
            <Link href="/pricing" className="ns-cta ns-cta--accent">
              Purchase · $49
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
