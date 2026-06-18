"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@ninesixteen/brand/Wordmark";

const INSTALLER_URL = process.env.NEXT_PUBLIC_DESKTOP_INSTALLER_URL?.trim() ?? "";
const VERSION = process.env.NEXT_PUBLIC_DESKTOP_VERSION?.trim() || "0.1.0";
const INSTALLER_FILENAME = INSTALLER_URL
  ? decodeURIComponent(INSTALLER_URL.split("/").pop() ?? "")
  : "";
const INSTALLER_EXT = INSTALLER_FILENAME.match(/\.(msi|exe)$/i)?.[1]?.toLowerCase() ?? "exe";

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
  "Open the app and hit Record — free, no account needed",
  "Pick 9×16 portrait or 16×9 landscape in Studio",
  "Frame, capture, and preview your clip in seconds",
  "Sign in and purchase Pro ($49) whenever you want to export",
];

const INCLUDED = [
  "True 9×16 or 16×9 capture with cursor-driven framing",
  "Alt + scroll zoom with rule-of-thirds guides",
  "System & microphone audio with live level meters",
  "Encrypted local recordings with built-in preview",
  "Native Windows Graphics Capture — low CPU, no Electron",
  "FFmpeg bundled — nothing else to install",
];

export function DownloadPageClient() {
  const [downloads, setDownloads] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats/downloads")
      .then((res) => res.json())
      .then((data: { downloads?: number }) => {
        if (!cancelled && typeof data.downloads === "number") {
          setDownloads(data.downloads);
        }
      })
      .catch(() => {
        if (!cancelled) setDownloads(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:py-10">
      <div className="text-center">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Download <Wordmark size={36} showSuffix />
        </h1>
        <p className="mx-auto mt-4 max-w-xl font-body text-sm leading-relaxed text-inksoft">
          Free Windows screen recorder for native 9×16 and 16×9 capture. Record and preview
          without an account — export MP4 with Pro ($49 one-time).
        </p>
      </div>

      <div className="ns-card mt-6 overflow-hidden sm:mt-8">
        <div className="grid gap-0 md:grid-cols-[1fr_auto]">
          <div className="border-b border-line p-8 md:border-b-0 md:border-r">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-[12px] border border-line bg-bgalt text-2xl">
                🪟
              </span>
              <div>
                <h2 className="font-display text-2xl">Windows installer</h2>
                <p className="font-mono text-xs text-inksoft">
                  v{VERSION} · x64 · NSIS
                </p>
              </div>
            </div>
            <ul className="mt-6 space-y-2.5">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 font-body text-sm text-inksoft">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-inkfaint" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col items-center justify-center gap-4 bg-bgalt p-8">
            {INSTALLER_URL ? (
              <a
                href="/api/download"
                className="ns-cta ns-cta--primary w-full max-w-xs text-center"
              >
                Download .{INSTALLER_EXT}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  alert(
                    "Installer URL not configured.\n\n1. Build: pnpm desktop:build\n2. Upload the installer from apps/desktop/src-tauri/target/release/bundle/\n3. Set NEXT_PUBLIC_DESKTOP_INSTALLER_URL in Vercel (and .env.local for dev)"
                  );
                }}
                className="ns-cta ns-cta--primary w-full max-w-xs text-center opacity-80"
              >
                Download .exe
              </button>
            )}
            <p className="text-center font-mono text-[11px] text-inkfaint">
              {INSTALLER_URL
                ? `v${VERSION} · Windows x64`
                : "Set NEXT_PUBLIC_DESKTOP_INSTALLER_URL to go live"}
            </p>
            {INSTALLER_URL && downloads !== null ? (
              <p className="text-center font-mono text-[10px] text-inkfaint">
                {downloads.toLocaleString()} download{downloads === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ns-card ns-card--flat mt-6 border-l border-linehi p-5 sm:p-6">
        <p className="font-display text-lg">A little note from the solo dev</p>
        <p className="mt-2 font-body text-sm leading-relaxed text-inksoft">
          Hi — I&apos;m building ninesixteen.video on my own. The Windows installer
          isn&apos;t code-signed yet (working on it!), so SmartScreen might pop up and
          say the app is from an unknown publisher. Totally normal for tiny indie
          software — you&apos;re still getting the real thing from this site.
        </p>
        <p className="mt-3 font-body text-sm leading-relaxed text-inksoft">
          If Windows says{" "}
          <span className="font-semibold text-ink">&ldquo;Windows protected your PC&rdquo;</span>
          , click{" "}
          <span className="font-semibold text-ink">More info</span>, then{" "}
          <span className="font-semibold text-ink">Run anyway</span>. Same steps if the
          installer asks again during setup.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoBlock title="Windows requirements" items={REQUIREMENTS} />
        <InfoBlock title="After install" items={AFTER_INSTALL} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <PlatformSoon icon="🍎" name="macOS" note="On the roadmap" />
        <PlatformSoon icon="🐧" name="Linux" note="On the roadmap" />
      </div>

      <p className="mt-8 text-center font-body text-sm text-inksoft">
        Questions?{" "}
        <Link href="/faq" className="ns-link">
          Read the FAQ
        </Link>
        {" · "}
        Already on Pro?{" "}
        <Link href="/dashboard" className="ns-link">
          Open your dashboard
        </Link>
        {" · "}
        <Link href="/pricing" className="ns-link">
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
