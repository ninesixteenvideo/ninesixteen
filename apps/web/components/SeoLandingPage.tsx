import Link from "next/link";
import type { LandingPageConfig } from "@/content/landingPages";
import { breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { JsonLd } from "@/components/JsonLd";

type SeoLandingPageProps = {
  page: LandingPageConfig;
};

export function SeoLandingPage({ page }: SeoLandingPageProps) {
  const path = `/${page.slug}`;

  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-10">
      <JsonLd
        data={[
          webPageJsonLd({
            title: page.title,
            description: page.metaDescription,
            path,
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: page.h1, path },
          ]),
        ]}
      />

      <nav className="font-mono text-xs text-inkfaint">
        <Link href="/" className="hover:text-inksoft">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-inksoft">{page.kicker}</span>
      </nav>

      <span className="ns-chip mt-6 inline-block">{page.kicker}</span>
      <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
        {page.h1}
      </h1>
      <p className="mt-5 max-w-2xl font-body text-lg leading-relaxed text-inksoft">
        {page.intro}
      </p>

      <ul className="mt-8 space-y-3">
        {page.bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-3 font-body text-sm leading-relaxed text-inksoft"
          >
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
            {bullet}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/download" className="ns-cta ns-cta--primary">
          Download for Windows
        </Link>
        <Link href="/pricing" className="ns-cta ns-cta--accent">
          Pro · $49 one-time
        </Link>
        <Link href="/faq" className="ns-cta ns-cta--ghost">
          Read FAQ
        </Link>
      </div>

      <aside className="ns-card ns-card--flat mt-14 p-6">
        <h2 className="font-display text-lg">Related</h2>
        <ul className="mt-3 space-y-2 font-body text-sm text-inksoft">
          <li>
            <Link href="/vertical-screen-recorder" className="ns-link">
              Vertical 9×16 screen recorder
            </Link>
          </li>
          <li>
            <Link href="/landscape-screen-recorder" className="ns-link">
              Landscape 16×9 screen recorder
            </Link>
          </li>
          <li>
            <Link href="/compare/obs" className="ns-link">
              ninesixteen vs OBS
            </Link>
          </li>
          <li>
            <Link href="/features" className="ns-link">
              Full feature list
            </Link>
          </li>
        </ul>
      </aside>
    </div>
  );
}
