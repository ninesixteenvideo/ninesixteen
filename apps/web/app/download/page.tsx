"use client";

import Link from "next/link";
import { Wordmark } from "@ninesixteen/brand/Wordmark";

const VERSION = "0.1.0";

const REQUIREMENTS = [
  "Windows 10 or 11 (64-bit)",
  "WebView2 — the installer will set this up if needed",
  "64-bit x64 CPU — Intel 8th gen / AMD Ryzen 2000 series or newer recommended",
  "8 GB RAM minimum · 16 GB recommended for longer recordings",
  "DirectX 11–compatible GPU with 2 GB VRAM or more",
  "1920×1080 display or higher (multi-monitor supported)",
  "~500 MB free disk space for the app · SSD recommended for recordings",
];

const AFTER_INSTALL = [
  "Open the app and hit Record — free to try, no account required",
  "Preview recordings in the app — export MP4 with Pro",
  "Sign in and upgrade to Pro when you want to export files",
];

const INCLUDED = [
  "Native Windows Graphics Capture — low CPU overhead",
  "9×16 vertical framing with cursor + Alt-scroll zoom",
  "Encrypted local recordings with in-app preview",
  "System & microphone audio with level meters",
  "FFmpeg bundled — nothing extra to install",
];

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <div className="text-center">
        <span className="ns-chip">Free download · free to try</span>
        <h1 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">
          Download <Wordmark size={36} showSuffix />
        </h1>
        <p className="mx-auto mt-4 max-w-lg font-body text-lg text-inksoft">
          One installer. Record, preview, and export — no command line, no
          drivers, no account. Subscribe to Pro only when you need MP4 export.
        </p>
      </div>

      <div className="ns-card mt-12 overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1fr_auto]">
          <div className="border-b-2 border-ink p-8 md:border-b-0 md:border-r-2">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-ink bg-bgalt text-2xl">
                🪟
              </span>
              <div>
                <h2 className="font-display text-2xl">Windows installer</h2>
                <p className="font-mono text-xs text-inksoft">
                  v{VERSION} · x64 · MSI / NSIS
                </p>
              </div>
            </div>
            <ul className="mt-6 space-y-2.5">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 font-body text-sm text-inksoft">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pink" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col items-center justify-center gap-4 bg-bgalt p-8">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                alert(
                  "Installer hosting coming soon.\n\nBuild locally with:\n  pnpm desktop:build\n\nFind the installer in apps/desktop/src-tauri/target/release/bundle/"
                );
              }}
              className="ns-cta ns-cta--primary w-full max-w-xs text-center"
            >
              Free download · .msi
            </a>
            <p className="text-center font-mono text-[11px] text-inkfaint">
              Signed build · auto-updates later
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <InfoBlock title="Windows requirements" items={REQUIREMENTS} />
        <InfoBlock title="After install" items={AFTER_INSTALL} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <PlatformSoon icon="🍎" name="macOS" note="On the roadmap" />
        <PlatformSoon icon="🐧" name="Linux" note="On the roadmap" />
      </div>

      <p className="mt-10 text-center font-body text-sm text-inksoft">
        Already on Pro?{" "}
        <Link href="/dashboard" className="font-semibold text-bluedeep hover:underline">
          Open your dashboard
        </Link>
        {" · "}
        <Link href="/pricing" className="font-semibold text-bluedeep hover:underline">
          View pricing
        </Link>
      </p>
    </div>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="ns-card ns-card--flat p-5">
      <h3 className="font-display text-lg">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="font-body text-sm text-inksoft">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlatformSoon({ icon, name, note }: { icon: string; name: string; note: string }) {
  return (
    <div className="ns-card flex items-center gap-4 bg-surfacesunken p-5 opacity-75">
      <span className="text-3xl">{icon}</span>
      <div>
        <h3 className="font-display text-lg">{name}</h3>
        <p className="font-mono text-xs text-inksoft">{note}</p>
      </div>
    </div>
  );
}
