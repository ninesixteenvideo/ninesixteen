import Link from "next/link";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  SERVICE_NAME,
  type LegalSection,
} from "@/lib/legalMeta";

export function LegalPage({
  title,
  summary,
  sections,
  sibling,
}: {
  title: string;
  summary: string;
  sections: LegalSection[];
  sibling: { href: string; label: string };
}) {
  return (
    <article className="legal-page mx-auto max-w-3xl px-5 py-16 pb-24">
      <header className="legal-page-header">
        <p className="font-mono text-xs uppercase tracking-wide text-inkfaint">Legal</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 font-body text-base leading-relaxed text-inksoft">{summary}</p>
        <p className="mt-3 font-mono text-xs text-inkfaint">
          Effective {LEGAL_EFFECTIVE_DATE} ·{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-ink hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
      </header>

      <nav className="legal-toc ns-card ns-card--flat mt-10 p-5" aria-label="On this page">
        <p className="font-display text-sm uppercase tracking-wide text-ink">On this page</p>
        <ol className="mt-3 space-y-1.5 font-body text-sm text-inksoft">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="hover:text-ink hover:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="legal-prose mt-10 space-y-10">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="legal-section scroll-mt-24">
            <h2 className="font-display text-2xl tracking-tight">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 48)} className="mt-4 font-body text-sm leading-relaxed text-inksoft">
                {paragraph}
              </p>
            ))}
            {section.bullets && section.bullets.length > 0 && (
              <ul className="mt-4 space-y-2 font-body text-sm leading-relaxed text-inksoft">
                {section.bullets.map((item) => (
                  <li key={item.slice(0, 48)} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-inkfaint" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <footer className="legal-page-footer mt-14 border-t border-line pt-8">
        <p className="font-body text-sm text-inksoft">
          Questions about these policies? Email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-semibold text-ink hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-4 font-body text-sm text-inksoft">
          See also{" "}
          <Link href={sibling.href} className="ns-link">
            {sibling.label}
          </Link>
          .
        </p>
        <p className="mt-6 font-mono text-[11px] text-inkfaint">
          © {new Date().getFullYear()} {SERVICE_NAME}
        </p>
      </footer>
    </article>
  );
}
