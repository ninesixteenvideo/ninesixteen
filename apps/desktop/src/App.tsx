import { useEffect, useState } from "react";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { useStore } from "./state/store";
import { useAuth } from "./lib/auth";
import { Studio } from "./components/Studio";
import { Preview } from "./components/Preview";
import { Settings } from "./components/Settings";
import { AccountMenu } from "./components/AccountMenu";
import { HotkeysModal } from "./components/HotkeysModal";
import { UpdateModal } from "./components/UpdateModal";
import { isDesktop } from "./lib/bridge";
import { canAutoUpdate, checkForUpdates, installAvailableUpdate } from "./lib/updater";

const BASE_TABS = [
  { id: "studio", label: "Studio" },
  { id: "preview", label: "Preview" },
  { id: "settings", label: "Settings" },
] as const;

export function App() {
  const { ready, tab, setTab, init, recording } = useStore();
  const { isPro } = useAuth();
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [updateOffer, setUpdateOffer] = useState<{ version: string } | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const tabs = BASE_TABS.map((t) =>
    t.id === "preview" ? { ...t, label: isPro ? "Library" : "Preview" } : t
  );

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!ready || !isDesktop || !canAutoUpdate()) return;
    const timer = window.setTimeout(() => {
      void checkForUpdates().then((result) => {
        if (result.status === "available") {
          setUpdateOffer({ version: result.version });
        }
      });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  async function handleInstallUpdate() {
    setUpdateInstalling(true);
    setUpdateError(null);
    const result = await installAvailableUpdate();
    if (result.status === "error") {
      setUpdateError(result.message);
      setUpdateInstalling(false);
    }
  }

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
        <div className="topbar-actions">
          {!isDesktop && (
            <span className="pill" style={{ background: "var(--ns-yellow)", color: "var(--ns-on-bright)" }}>
              web preview
            </span>
          )}
          {recording && <span className="pill rec-dot">REC</span>}
          {/* Virtual camera (CamStatus) deferred to v1.1 — recording-only for v1. */}
          <AccountMenu />
          {isDesktop && (
            <button
              type="button"
              className="tab tab-hotkeys"
              onClick={() => setHotkeysOpen(true)}
            >
              Hotkeys
            </button>
          )}
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

      {hotkeysOpen && <HotkeysModal onClose={() => setHotkeysOpen(false)} />}
      {updateOffer && (
        <UpdateModal
          version={updateOffer.version}
          installing={updateInstalling}
          error={updateError}
          onClose={() => setUpdateOffer(null)}
          onUpdate={() => void handleInstallUpdate()}
        />
      )}
    </div>
  );
}
