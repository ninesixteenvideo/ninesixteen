"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import {
  getFeaturedUseCasePages,
  getLandingPageLinkLabel,
} from "@/content/landingPages";

export function SiteFooter() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const featured = getFeaturedUseCasePages();

  if (isHome) {
    return (
      <footer className="home-footer home-footer--dock">
        <div className="home-footer__bar">
          <span>© {new Date().getFullYear()} ninesixteen.video</span>
          <div className="home-footer__legal">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-8 border-t border-line bg-bgalt">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark size={26} showSuffix />
          <p className="mt-4 max-w-xs font-body text-sm leading-relaxed text-inksoft">
            Native 9×16 and 16×9 screen recorder for Windows — cursor framing, Game mode, and Pro
            export up to 4K landscape.
          </p>
        </div>
        <div>
          <h4 className="font-display text-sm uppercase tracking-wide text-ink">Product</h4>
          <ul className="mt-3 space-y-2 font-body text-sm text-inksoft">
            <li><Link href="/features" className="hover:text-ink">Features</Link></li>
            <li><Link href="/vertical-screen-recorder" className="hover:text-ink">9×16 recorder</Link></li>
            <li><Link href="/landscape-screen-recorder" className="hover:text-ink">16×9 recorder</Link></li>
            <li><Link href="/compare/obs" className="hover:text-ink">vs OBS</Link></li>
            <li><Link href="/faq" className="hover:text-ink">FAQ</Link></li>
            <li><Link href="/changelog" className="hover:text-ink">Changelog</Link></li>
            <li><Link href="/pricing" className="hover:text-ink">Purchase</Link></li>
            <li><Link href="/download" className="hover:text-ink">Download</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-display text-sm uppercase tracking-wide text-ink">Use cases</h4>
          <ul className="mt-3 space-y-2 font-body text-sm text-inksoft">
            {featured.map((page) => (
              <li key={page.slug}>
                <Link href={`/${page.slug}`} className="hover:text-ink">
                  {getLandingPageLinkLabel(page)}
                </Link>
              </li>
            ))}
          </ul>
          <h4 className="mt-6 font-display text-sm uppercase tracking-wide text-ink">Account</h4>
          <ul className="mt-3 space-y-2 font-body text-sm text-inksoft">
            <li><Link href="/sign-in" className="hover:text-ink">Sign in</Link></li>
            <li><Link href="/sign-up" className="hover:text-ink">Create account</Link></li>
            <li><Link href="/dashboard" className="hover:text-ink">Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-display text-sm uppercase tracking-wide text-ink">Legal</h4>
          <ul className="mt-3 space-y-2 font-body text-sm text-inksoft">
            <li><Link href="/terms" className="hover:text-ink">Terms of Use</Link></li>
            <li><Link href="/privacy" className="hover:text-ink">Privacy Policy</Link></li>
            <li><a href="/llms.txt" className="hover:text-ink">llms.txt</a></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-linesoft">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-5 font-mono text-xs text-inkfaint sm:flex-row">
          <span>© {new Date().getFullYear()} ninesixteen.video</span>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link href="/terms" className="hover:text-inksoft">Terms</Link>
            <Link href="/privacy" className="hover:text-inksoft">Privacy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
