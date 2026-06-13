"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#two-handed", label: "Two-handed" },
  { href: "/pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
];

export function SiteHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink/90 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="shrink-0" aria-label="ninesixteen.video home">
          <Wordmark size={30} showSuffix />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="font-body text-sm font-medium text-inksoft transition-colors hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {!loading && user ? (
            <Link
              href="/dashboard"
              className="rounded-full border-2 border-ink bg-blue px-4 py-1.5 font-display text-sm shadow-[3px_3px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="hidden rounded-full px-3 py-1.5 font-display text-sm text-ink transition-colors hover:text-bluedeep sm:inline-block"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-full border-2 border-ink bg-pink px-4 py-1.5 font-display text-sm shadow-[3px_3px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
      {pathname === "/" && (
        <div className="overflow-hidden border-t-2 border-ink bg-yellow">
          <div className="ns-marquee flex w-[200%] gap-10 whitespace-nowrap py-1.5 font-mono text-xs uppercase tracking-widest text-ink">
            {Array.from({ length: 2 }).map((_, i) => (
              <span key={i} className="flex gap-10">
                <span>16×9 widescreen</span>
                <span>•</span>
                <span>9×16 vertical</span>
                <span>•</span>
                <span>two-handed framing</span>
                <span>•</span>
                <span>local-first recording</span>
                <span>•</span>
                <span>buttery-smooth pan · zoom · rotate</span>
                <span>•</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
