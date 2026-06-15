"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand";
import { useAuth } from "@/lib/auth";

const TICKER = [
  "true 9×16 capture",
  "no crop in post",
  "frame with your cursor",
  "alt + scroll to zoom",
  "system + mic audio",
  "built for short-form content",
  "one-time $49 · no subscription",
  "private & local-first",
];

export function SiteHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink/90 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="shrink-0" aria-label="ninesixteen.video home">
          <Wordmark size={30} showSuffix />
        </Link>

        <div className="flex items-center gap-2">
          {!loading && user ? (
            <Link href="/dashboard" className="ns-cta ns-cta--sm ns-cta--primary">
              Dashboard
            </Link>
          ) : (
            <Link href="/sign-in" className="ns-cta ns-cta--sm ns-cta--accent">
              Sign in
            </Link>
          )}
        </div>
      </div>
      {pathname === "/" && (
        <div className="overflow-hidden border-t-2 border-ink bg-yellow">
          <div className="ns-marquee flex w-[200%] gap-10 whitespace-nowrap py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-onbright">
            {Array.from({ length: 2 }).map((_, i) => (
              <span key={i} className="flex gap-10">
                {TICKER.map((item) => (
                  <span key={`${i}-${item}`} className="flex gap-10">
                    <span>{item}</span>
                    <span>•</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
