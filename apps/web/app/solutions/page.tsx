import Link from "next/link";
import type { Metadata } from "next";
import { LANDING_PAGES } from "@/content/landingPages";
import { getLandingPageLinkLabel } from "@/content/landingPages";
import type { LandingPageConfig } from "@/content/landingPageTypes";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/JsonLd";

export const metadata: Metadata = buildPageMetadata({
  title: "Screen recording guides",
  description:
    "Index of ninesixteen.video recording guides — native 9×16 and 16×9 capture topics for Windows creators.",
  path: "/solutions",
  keywords: ["screen recording guides", "vertical screen recorder", "9x16 recorder"],
});

const CATEGORY_LABEL: Record<string, string> = {
  format: "Aspect ratio",
  platform: "Platforms",
  usecase: "Use cases",
  comparison: "Comparisons",
  workflow: "Workflows",
};

function groupPages(pages: readonly LandingPageConfig[]) {
  const groups = new Map<string, LandingPageConfig[]>();
  for (const page of pages) {
    const key = CATEGORY_LABEL[page.category ?? ""] ?? page.kicker ?? "Guides";
    const list = groups.get(key) ?? [];
    list.push(page);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function SolutionsPage() {
  const groups = groupPages(LANDING_PAGES);
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ninesixteen.video";

  return (
    <div className="solutions mx-auto max-w-4xl px-5 py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Screen recording guides",
          description: metadata.description,
          url: `${siteUrl.replace(/\/$/, "")}/solutions`,
          hasPart: LANDING_PAGES.map((page) => ({
            "@type": "WebPage",
            name: page.title,
            url: `${siteUrl.replace(/\/$/, "")}/${page.slug}`,
          })),
        }}
      />

      <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-inkfaint">
        Index
      </p>
      <h1 className="mt-3 font-display text-3xl tracking-tight text-ink">Recording guides</h1>
      <p className="mt-3 max-w-xl font-body text-sm text-inksoft">
        Topic index for native 9×16 and 16×9 screen recording on Windows.
      </p>

      <nav className="mt-12 space-y-10" aria-label="Recording guide topics">
        {groups.map(([label, pages]) => (
          <section key={label}>
            <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-inkfaint">
              {label}
            </h2>
            <ul className="mt-3 columns-1 gap-x-8 sm:columns-2">
              {pages.map((page) => (
                <li key={page.slug} className="mb-2 break-inside-avoid">
                  <Link href={`/${page.slug}`} className="text-sm text-inksoft hover:text-ink">
                    {getLandingPageLinkLabel(page)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}
