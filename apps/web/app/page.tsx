import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { FAQ_ITEMS } from "@/content/faq";
import { FeaturesGrid, StepsGrid, UseCasesGrid } from "@/components/LandingCardSections";
import { HeroVideo } from "@/components/HeroVideo";
import { ReleaseNotesLink } from "@/components/ReleaseNotesLink";
import { ReleaseNotesSection } from "@/components/ReleaseNotes";
import { FaqSection } from "@/components/FaqSection";

export default function HomePage() {
  const homeFaq = FAQ_ITEMS.slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* HERO */}
      <section className="grid items-center gap-8 pb-12 pt-16 md:grid-cols-[1.15fr_1fr] md:gap-4 md:pb-14 md:pt-24">
        <div>
          <span className="ns-chip inline-block">Windows · 9×16 &amp; 16×9 screen recorder</span>
          <h1 className="mt-6 font-display text-[2.75rem] leading-[1.02] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]">
            Your desktop,
            <br />
            native aspect.
          </h1>
          <p className="mt-6 max-w-lg font-body text-lg leading-relaxed text-inksoft">
            <Wordmark size={20} /> records your screen in true{" "}
            <b className="font-semibold text-ink">9×16</b> or{" "}
            <b className="font-semibold text-ink">16×9</b> — no cropping, no reframing
            in post production. Follow your cursor, zoom with Alt + scroll, and walk away with
            footage that drops straight into CapCut, Premiere, or your editor of choice.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/download" className="ns-cta ns-cta--primary">
              Download
            </Link>
            <Link href="/pricing" className="ns-cta ns-cta--accent">
              Purchase · $49 USD
            </Link>
          </div>
          <p className="ns-hero-caption mt-5">
            Record &amp; preview free · $49 one-time purchase · No account to start
          </p>
        </div>

        <div className="relative flex justify-center md:justify-start md:self-start md:-mt-[46px]">
          <HeroVideo />
          <ReleaseNotesLink />
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
            Portrait for Shorts and Reels, landscape for demos and tutorials — one framing
            workflow, native aspect from frame one.
          </p>
        </div>
        <UseCasesGrid />
      </section>

      {/* FEATURES */}
      <section id="features" className="py-16">
        <SectionHeading
          kicker="What you get"
          title="Everything to shoot vertical or widescreen, faster than ever."
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

      <FaqSection
        items={homeFaq}
        title="Common questions"
        showViewAll
      />

      <ReleaseNotesSection />
    </div>
  );
}

const STATS = [
  { value: "9×16 · 16×9", label: "Portrait & landscape" },
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
