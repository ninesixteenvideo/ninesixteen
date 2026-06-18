import Link from "next/link";
import { FeaturesGrid } from "@/components/LandingCardSections";
import { JsonLd } from "@/components/JsonLd";
import { PRODUCT_FEATURES } from "@/lib/site";
import { breadcrumbJsonLd, softwareApplicationJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Features — native 9×16 & 16×9 Windows screen recorder",
  description:
    "Cursor-driven framing, Alt + scroll zoom, system + mic audio, optional click sounds, encrypted local recordings, virtual camera, and one-time $49 Pro export.",
  path: "/features",
  keywords: [
    "screen recorder features",
    "cursor framing recorder",
    "vertical recorder features windows",
  ],
});

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-10">
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          webPageJsonLd({
            title: "Features",
            description: "ninesixteen.video feature list",
            path: "/features",
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Features", path: "/features" },
          ]),
        ]}
      />

      <nav className="font-mono text-xs text-inkfaint">
        <Link href="/" className="hover:text-inksoft">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-inksoft">Features</span>
      </nav>

      <span className="ns-chip mt-6 inline-block">Product</span>
      <h1 className="mt-5 font-display text-4xl tracking-tight sm:text-5xl">
        Built for native aspect screen recording
      </h1>
      <p className="mt-5 max-w-2xl font-body text-lg leading-relaxed text-inksoft">
        Everything in ninesixteen.video is designed around one idea: what you frame is what you
        export — in 9×16 or 16×9, with no crop pass in post.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {PRODUCT_FEATURES.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 font-body text-sm text-inksoft"
          >
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-14">
        <h2 className="font-display text-3xl tracking-tight">How it fits together</h2>
        <FeaturesGrid />
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link href="/download" className="ns-cta ns-cta--primary">
          Download for Windows
        </Link>
        <Link href="/faq" className="ns-cta ns-cta--ghost">
          FAQ
        </Link>
      </div>
    </div>
  );
}
