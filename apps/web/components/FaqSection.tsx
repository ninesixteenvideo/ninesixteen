import Link from "next/link";
import type { FaqItem } from "@/content/faq";
import { faqPageJsonLd } from "@/lib/seo/jsonLd";
import { JsonLd } from "@/components/JsonLd";

type FaqSectionProps = {
  items: readonly FaqItem[];
  title?: string;
  kicker?: string;
  showViewAll?: boolean;
  id?: string;
};

export function FaqSection({
  items,
  title = "Frequently asked questions",
  kicker = "FAQ",
  showViewAll = false,
  id = "faq",
}: FaqSectionProps) {
  return (
    <section id={id} className="scroll-mt-28 py-16">
      <JsonLd data={faqPageJsonLd(items)} />
      <div className="ns-card ns-card--flat overflow-hidden">
        <div className="border-b border-line px-6 py-8 md:px-10">
          <span className="ns-chip">{kicker}</span>
          <h2 className="mt-4 font-display text-3xl tracking-tight sm:text-4xl">{title}</h2>
          <p className="mt-3 max-w-xl font-body text-sm text-inksoft">
            Direct answers about recording, pricing, formats, and Windows requirements.
          </p>
        </div>
        <div className="divide-y divide-line">
          {items.map((item) => (
            <details key={item.question} className="group px-6 py-5 md:px-10">
              <summary className="cursor-pointer list-none font-display text-lg text-ink marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-start justify-between gap-4">
                  {item.question}
                  <span className="mt-1 shrink-0 font-mono text-xs text-inkfaint transition group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 max-w-3xl font-body text-sm leading-relaxed text-inksoft">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
        {showViewAll ? (
          <div className="border-t border-line px-6 py-5 md:px-10">
            <Link href="/faq" className="ns-link font-body text-sm">
              View all questions →
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
