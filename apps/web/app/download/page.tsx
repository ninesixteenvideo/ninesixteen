"use client";

import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";

const VERSION = "0.1.0-beta";

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <div className="text-center">
        <span className="ns-chip">Free beta</span>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl">
          Download <Wordmark size={36} showSuffix />
        </h1>
        <p className="mx-auto mt-4 max-w-lg font-body text-inksoft">
          A tiny native app. No account required to try it — sign in only when you want
          to manage billing.
        </p>
      </div>

      <div className="ns-card mt-12 grid items-center gap-6 p-8 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-4xl">🪟</span>
            <div>
              <h2 className="font-display text-2xl">Windows 10 / 11</h2>
              <p className="font-mono text-xs text-inksoft">
                v{VERSION} · x64 · ~8 MB installer
              </p>
            </div>
          </div>
          <ul className="mt-5 space-y-2 font-body text-sm text-inksoft">
            <li>• Native Windows Graphics Capture — low CPU.</li>
            <li>• Plug in a second mouse for two-handed framing.</li>
            <li>• Records straight to your local disk.</li>
          </ul>
        </div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            alert(
              "Beta installer not published yet.\n\nBuild it locally with:\n  pnpm desktop:build\n\nThe installer will appear in apps/desktop/src-tauri/target/release/bundle/."
            );
          }}
          className="rounded-full border-2 border-ink bg-blue px-7 py-4 text-center font-display text-lg shadow-[5px_5px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          Download .msi
        </a>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <PlatformSoon icon="🍎" name="macOS" note="Universal build — coming next" />
        <PlatformSoon icon="🐧" name="Linux" note="AppImage — on the roadmap" />
      </div>

      <p className="mt-10 text-center font-body text-sm text-inksoft">
        Building from source?{" "}
        <Link href="/dashboard" className="font-semibold text-bluedeep hover:underline">
          See your dashboard
        </Link>{" "}
        or check the repo README.
      </p>
    </div>
  );
}

function PlatformSoon({ icon, name, note }: { icon: string; name: string; note: string }) {
  return (
    <div className="ns-card flex items-center gap-4 bg-surfacesunken p-5 opacity-80">
      <span className="text-3xl">{icon}</span>
      <div>
        <h3 className="font-display text-lg">{name}</h3>
        <p className="font-mono text-xs text-inksoft">{note}</p>
      </div>
    </div>
  );
}
