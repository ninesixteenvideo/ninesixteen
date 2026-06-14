import { useEffect } from "react";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { useStore } from "./state/store";
import { useAuth } from "./lib/auth";
import { Studio } from "./components/Studio";
import { Preview } from "./components/Preview";
import { Settings } from "./components/Settings";
import { AccountMenu } from "./components/AccountMenu";
import { CamStatus } from "./components/CamStatus";
import { isDesktop } from "./lib/bridge";

const BASE_TABS = [
  { id: "studio", label: "Studio" },
  { id: "preview", label: "Preview" },
  { id: "settings", label: "Settings" },
] as const;

export function App() {
  const { ready, tab, setTab, init, recording } = useStore();
  const { isPro } = useAuth();

  const tabs = BASE_TABS.map((t) =>
    t.id === "preview" ? { ...t, label: isPro ? "Library" : "Preview" } : t
  );

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app">
      <header className="topbar">
        <Wordmark size={22} showSuffix />
        <nav className="tabs">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isDesktop && (
            <span className="pill" style={{ background: "var(--ns-yellow)", color: "var(--ns-ink)" }}>
              web preview
            </span>
          )}
          {recording && <span className="pill rec-dot">REC</span>}
          {isDesktop && ready && <CamStatus />}
          <AccountMenu />
        </div>
      </header>

      {!ready ? (
        <div className="empty">
          <Wordmark size={32} showSuffix />
          <p className="muted">Loading…</p>
        </div>
      ) : (
        <div className="tab-view" key={tab}>
          {tab === "studio" ? <Studio /> : tab === "preview" ? <Preview /> : <Settings />}
        </div>
      )}
    </div>
  );
}
