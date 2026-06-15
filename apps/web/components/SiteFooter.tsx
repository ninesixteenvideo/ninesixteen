import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";

export function SiteFooter() {
  return (
    <footer className="mt-8 border-t-2 border-ink bg-bgalt">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark size={26} showSuffix />
          <p className="mt-4 max-w-xs font-body text-sm leading-relaxed text-inksoft">
            The vertical screen recorder for Windows. Frame with your cursor, record locally,
            and export clean MP4s with Pro.
          </p>
        </div>
        <div>
          <h4 className="font-display text-sm uppercase tracking-wide text-ink">Product</h4>
          <ul className="mt-3 space-y-2 font-body text-sm text-inksoft">
            <li><a href="/#features" className="hover:text-ink">Features</a></li>
            <li><a href="/#how-it-works" className="hover:text-ink">How it works</a></li>
            <li><Link href="/pricing" className="hover:text-ink">Purchase</Link></li>
            <li><Link href="/download" className="hover:text-ink">Download</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-display text-sm uppercase tracking-wide text-ink">Account</h4>
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
          </ul>
        </div>
      </div>
      <div className="border-t border-linesoft">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-5 font-mono text-xs text-inkfaint sm:flex-row">
          <span>© {new Date().getFullYear()} ninesixteen.video</span>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link href="/terms" className="hover:text-inksoft">Terms</Link>
            <Link href="/privacy" className="hover:text-inksoft">Privacy</Link>
            <span>Windows · 9×16 · local-first</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
