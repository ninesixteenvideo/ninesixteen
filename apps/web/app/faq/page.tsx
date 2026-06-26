import Link from "next/link";
import { FAQ_ITEMS } from "@/content/faq";
import { FaqSection } from "@/components/FaqSection";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "FAQ — vertical & landscape screen recording on Windows",
  description:
    "Answers about ninesixteen.video: 9×16 and 16×9 capture, Game mode, pricing, quality settings, OBS comparison, and Pro export.",
  path: "/faq",
  keywords: [
    "ninesixteen faq",
    "vertical screen recorder questions",
    "9x16 recorder help",
    "windows screen recorder pricing",
  ],
});

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-10">
      <JsonLd
        data={[
          webPageJsonLd({
            title: "FAQ",
            description: "Frequently asked questions about ninesixteen.video",
            path: "/faq",
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "FAQ", path: "/faq" },
          ]),
        ]}
      />
      <nav className="font-mono text-xs text-inkfaint">
        <Link href="/" className="hover:text-inksoft">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-inksoft">FAQ</span>
      </nav>
      <div className="mt-8">
        <FaqSection items={FAQ_ITEMS} title="Everything you need to know" showViewAll={false} />
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/download" className="ns-cta ns-cta--primary">
          Download for Windows
        </Link>
        <Link href="/compare/obs" className="ns-cta ns-cta--ghost">
          Compare with OBS
        </Link>
      </div>
    </div>
  );
}
