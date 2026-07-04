"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WordmarkTv } from "@/components/WordmarkTv";
import { useAuth } from "@/lib/auth";

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bgalt/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="shrink-0" aria-label="ninesixteen.video home">
          <WordmarkTv size={30} showSuffix wrapClassName="ns-wm-tv--nav" className="ns-wm-nav" />
        </Link>

        <div className="flex items-center gap-2">
          {!loading && user ? (
            <>
              <Link href="/dashboard" className="ns-cta ns-cta--sm ns-cta--primary">
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                className="ns-cta ns-cta--sm ns-cta--ghost"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/?view=sign-in" className="ns-cta ns-cta--sm ns-cta--ghost">
                Sign in
              </Link>
              <Link href="/?view=sign-up" className="ns-cta ns-cta--sm ns-cta--primary">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
