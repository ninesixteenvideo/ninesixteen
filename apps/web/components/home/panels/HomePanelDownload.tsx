"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PRODUCT_FEATURES } from "@/lib/site";
import { HomeBackControl } from "../HomeBackControl";

const INSTALLER_URL = process.env.NEXT_PUBLIC_DESKTOP_INSTALLER_URL?.trim() ?? "";
const VERSION = process.env.NEXT_PUBLIC_DESKTOP_VERSION?.trim() || "1.2.1";
const INSTALLER_FILENAME = INSTALLER_URL
  ? decodeURIComponent(INSTALLER_URL.split("/").pop() ?? "")
  : "";
const INSTALLER_EXT = INSTALLER_FILENAME.match(/\.(msi|exe)$/i)?.[1]?.toLowerCase() ?? "exe";

const INCLUDED = PRODUCT_FEATURES.slice(0, 8);

type HomePanelDownloadProps = {
  onBack: () => void;
  onPricing: () => void;
};

export function HomePanelDownload({ onBack, onPricing }: HomePanelDownloadProps) {
  const [downloads, setDownloads] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats/downloads")
      .then((res) => res.json())
      .then((data: { downloads?: number }) => {
        if (!cancelled && typeof data.downloads === "number") setDownloads(data.downloads);
      })
      .catch(() => {
        if (!cancelled) setDownloads(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="home-panel" aria-label="Download">
      <HomeBackControl onBack={onBack} />
      <p className="home-panel__kicker">Windows · x64</p>
      <h2 className="home-panel__heading">Get the installer</h2>
      <p className="home-panel__lede">
        Record and preview free — no account required. Pro export unlocks on the{" "}
        <button type="button" className="home-panel__inline" onClick={onPricing}>
          $49 license
        </button>
        .
      </p>

      <div className="home-panel__card home-panel__card--split">
        <ul className="home-panel__list">
          {INCLUDED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="home-panel__cta-col">
          {INSTALLER_URL ? (
            <a href="/api/download" className="home-panel__btn home-panel__btn--mint">
              Download .{INSTALLER_EXT}
            </a>
          ) : (
            <button
              type="button"
              className="home-panel__btn home-panel__btn--mint home-panel__btn--muted"
              onClick={() =>
                alert(
                  "Installer URL not configured.\n\nBuild the desktop app and set NEXT_PUBLIC_DESKTOP_INSTALLER_URL."
                )
              }
            >
              Download .exe
            </button>
          )}
          <p className="home-panel__meta">v{VERSION} · NSIS installer</p>
          {INSTALLER_URL && downloads !== null ? (
            <p className="home-panel__meta">{downloads.toLocaleString()} downloads</p>
          ) : null}
        </div>
      </div>

      <div className="home-panel__note">
        <p>
          SmartScreen may warn — the installer is not code-signed yet. Click{" "}
          <strong>More info</strong> → <strong>Run anyway</strong>.
        </p>
      </div>

      <p className="home-panel__foot">
        Questions?{" "}
        <Link href="/faq" className="home-panel__link">
          FAQ
        </Link>
      </p>
    </section>
  );
}
