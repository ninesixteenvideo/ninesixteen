import Link from "next/link";
import { OBS_COMPARE } from "@/content/landingPages";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: OBS_COMPARE.title,
  description: OBS_COMPARE.metaDescription,
  path: "/compare/obs",
  keywords: [
    "ninesixteen vs obs",
    "obs alternative vertical",
    "best screen recorder for tiktok",
    "vertical recording obs crop",
  ],
});

export default function ObsComparePage() {
  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-10">
      <JsonLd
        data={[
          webPageJsonLd({
            title: OBS_COMPARE.title,
            description: OBS_COMPARE.metaDescription,
            path: "/compare/obs",
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Compare", path: "/compare/obs" },
          ]),
        ]}
      />

      <nav className="font-mono text-xs text-inkfaint">
        <Link href="/" className="hover:text-inksoft">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-inksoft">vs OBS</span>
      </nav>

      <span className="ns-chip mt-6 inline-block">Comparison</span>
      <h1 className="mt-5 font-display text-4xl tracking-tight sm:text-5xl">
        {OBS_COMPARE.h1}
      </h1>
      <p className="mt-5 max-w-2xl font-body text-lg leading-relaxed text-inksoft">
        {OBS_COMPARE.intro}
      </p>

      <div className="ns-card ns-card--flat mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left font-body text-sm">
          <thead>
            <tr className="border-b border-line bg-surfacesunken">
              <th className="px-5 py-4 font-display text-sm uppercase tracking-wide">Topic</th>
              <th className="px-5 py-4 font-display text-sm uppercase tracking-wide text-mint">
                ninesixteen.video
              </th>
              <th className="px-5 py-4 font-display text-sm uppercase tracking-wide">OBS</th>
            </tr>
          </thead>
          <tbody>
            {OBS_COMPARE.rows.map((row) => (
              <tr key={row.topic} className="border-b border-line align-top">
                <th className="px-5 py-4 font-semibold text-ink">{row.topic}</th>
                <td className="px-5 py-4 text-inksoft">{row.ninesixteen}</td>
                <td className="px-5 py-4 text-inksoft">{row.obs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-8 max-w-2xl font-body text-sm leading-relaxed text-inksoft">
        {OBS_COMPARE.verdict}
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/download" className="ns-cta ns-cta--primary">
          Try ninesixteen.video
        </Link>
        <Link href="/vertical-screen-recorder" className="ns-cta ns-cta--ghost">
          Vertical recorder guide
        </Link>
      </div>
    </div>
  );
}
