import { useEffect, useRef, useState } from "react";
import { RailWordmark } from "./components/RailWordmark";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { useStore } from "./state/store";
import { useAuth } from "./lib/auth";
import { Studio } from "./components/Studio";
import { Preview } from "./components/Preview";
import { FilmDock, type FilmDockHandle } from "./components/FilmDock";
import { Account } from "./components/Account";
import { Info } from "./components/Info";
import { Hotkeys } from "./components/Hotkeys";
import { HardwareRecHint } from "./components/HardwareRecHint";
import { Paywall } from "./components/Paywall";
import { UpdateModal } from "./components/UpdateModal";
import { isDesktop } from "./lib/bridge";
import { useDockLayout } from "./lib/useDockLayout";
import { canAutoUpdate, checkForUpdates, installAvailableUpdate } from "./lib/updater";
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  HelpIcon,
  KeyboardIcon,
  LibraryIcon,
  MinimizeIcon,
  StopIcon,
  StudioIcon,
  UserIcon,
} from "./components/icons";

type TabId = "studio" | "preview" | "hotkeys" | "account" | "info";

export function App() {
  const {
    ready,
    tab,
    setTab,
    ensureLibrarySelection,
    init,
    recording,
    arming,
    finalizing,
    librarySelectedId,
    setLibrarySelected,
    paywallOpen,
    setPaywallOpen,
    promoMode,
    recordingSettings,
    recordings,
    hardwareProfile,
  } = useStore();
  const { isPro } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [filmExtended, setFilmExtended] = useState(false);
  const filmRef = useRef<FilmDockHandle>(null);
  const [updateOffer, setUpdateOffer] = useState<{ version: string } | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [trayToast, setTrayToast] = useState<string | null>(null);
  const hidingToTrayRef = useRef(false);

  // Live capture = countdown or recording: the overlay owns the desktop, so the
  // dock hides entirely — unless promo recording (marketing mode keeps the app up).
  const promoSession = Boolean(promoMode) && (recording || arming);
  const liveCapture = (recording || arming) && !promoSession;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const restoreExpanded = useRef(expanded);

  const selectedRecording = recordings.find((r) => r.id === librarySelectedId);
  const filmOrientation =
    selectedRecording?.orientation ?? recordingSettings.orientation;

  const libraryTab = tab === "preview";

  const { sidebarPx } = useDockLayout({
    ready,
    expanded,
    capturing: liveCapture,
    libraryTab,
    filmSelected: libraryTab && !!librarySelectedId,
    filmVisible: libraryTab && filmExtended,
    filmOrientation,
  });

  useEffect(() => {
    if (promoSession) {
      restoreExpanded.current = expandedRef.current;
      setExpanded(true);
      return;
    }
    if (liveCapture) {
      restoreExpanded.current = expandedRef.current;
      setExpanded(false);
      setLibrarySelected(null);
    }
  }, [liveCapture, promoSession, setLibrarySelected]);

  // Pop the panel open so the processing state is visible the moment we stop.
  useEffect(() => {
    if (finalizing) setExpanded(true);
  }, [finalizing]);

  // Everything done — return the dock to however the user left it.
  useEffect(() => {
    if (!recording && !arming && !finalizing) {
      setExpanded(restoreExpanded.current);
    }
  }, [recording, arming, finalizing]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!ready || !isDesktop || !canAutoUpdate()) return;
    const timer = window.setTimeout(() => {
      void checkForUpdates().then((result) => {
        if (result.status === "available") setUpdateOffer({ version: result.version });
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

  async function hideToTray() {
    if (!isDesktop || hidingToTrayRef.current) return;
    hidingToTrayRef.current = true;
    setTrayToast("Running in the system tray");
    await new Promise((resolve) => window.setTimeout(resolve, 2200));
    setTrayToast(null);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
    hidingToTrayRef.current = false;
  }

  function retractFilmThen(action: () => void) {
    if (tab === "preview" && librarySelectedId) {
      void filmRef.current?.fadeOut().then(() => {
        setLibrarySelected(null);
        action();
      });
      return true;
    }
    return false;
  }

  function openTab(id: TabId) {
    if (id === tab) {
      if (!expanded) setExpanded(true);
      if (id === "preview") ensureLibrarySelection();
      return;
    }
    if (retractFilmThen(() => {
      setTab(id);
      setExpanded(true);
    })) {
      return;
    }
    setTab(id);
    if (!expanded) setExpanded(true);
  }

  function toggleExpanded() {
    if (expanded) {
      if (retractFilmThen(() => setExpanded(false))) return;
      setExpanded(false);
      return;
    }
    setExpanded(true);
  }

  const previewLabel = "Library";
  const studioRec =
    hardwareProfile?.[
      recordingSettings.orientation === "landscape" ? "landscape" : "portrait"
    ] ?? null;
  const headings: Record<TabId, { title: string; sub: string }> = {
    studio: { title: "Studio", sub: "" },
    preview: {
      title: previewLabel,
      sub: isPro ? "Review, export, and manage your takes." : "Preview takes — upgrade to export.",
    },
    hotkeys: { title: "Shortcuts", sub: "Capture and framing keyboard shortcuts." },
    account: { title: "Account", sub: "Sign in and manage your plan." },
    info: { title: "Info & feedback", sub: "Feedback, updates, and legal." },
  };

  return (
    <div className="shell">
      <aside
        className={`sidebar ${expanded ? "expanded" : "collapsed"} ${liveCapture ? "capturing" : ""} ${promoSession ? "promo-capturing" : ""}`}
      >
        <nav className="rail" aria-label="Primary">
          <div className="rail-win">
            <WindowButton label="Close" onClick={() => void closeWindow()}>
              <CloseIcon size={16} />
            </WindowButton>
            <WindowButton label="Minimize" onClick={() => void hideToTray()}>
              <MinimizeIcon size={16} />
            </WindowButton>
          </div>

          <div className="rail-tabs" role="tablist">
            <RailTab id="studio" label="Studio" active={tab === "studio"} onClick={openTab}>
              <StudioIcon size={25} />
            </RailTab>
            <RailTab id="preview" label={previewLabel} active={tab === "preview"} onClick={openTab}>
              <LibraryIcon size={25} />
            </RailTab>
            <RailTab id="hotkeys" label="Shortcuts" active={tab === "hotkeys"} onClick={openTab}>
              <KeyboardIcon size={25} />
            </RailTab>
            <RailTab id="account" label="Account" active={tab === "account"} onClick={openTab}>
              <UserIcon size={25} />
            </RailTab>
            <RailTab id="info" label="Info & feedback" active={tab === "info"} onClick={openTab}>
              <HelpIcon size={25} />
            </RailTab>
          </div>

          <div className="rail-spacer" />

          <div className="rail-wordmark">
            <RailWordmark orientation={recordingSettings.orientation} size={24} />
          </div>
        </nav>

        <section className="panel" aria-hidden={!expanded}>
          <header className="panel-head">
            <div className="panel-head-text">
              <h1 className="panel-title">{finalizing ? "Processing" : headings[tab as TabId].title}</h1>
              {finalizing ? (
                <p className="panel-sub">Saving your recording — hang tight.</p>
              ) : tab === "studio" ? (
                <HardwareRecHint
                  orientation={recordingSettings.orientation}
                  quality={recordingSettings.quality}
                  fps={recordingSettings.fps}
                  recommendation={studioRec}
                />
              ) : (
                <p className="panel-sub">{headings[tab as TabId].sub}</p>
              )}
            </div>
            {tab === "studio" && !finalizing && <RecordControl />}
          </header>
          {finalizing ? <Processing /> : <TabbedBody tab={tab as TabId} />}
        </section>

        <button
          type="button"
          className="handle"
          onClick={toggleExpanded}
          aria-label={expanded ? "Collapse panel" : "Expand panel"}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </aside>

      {libraryTab && <FilmDock ref={filmRef} onExtendedChange={setFilmExtended} />}

      {!ready && (
        <div className="boot" style={{ width: sidebarPx }}>
          <Wordmark size={30} showSuffix />
          <p>Loading…</p>
        </div>
      )}

      {paywallOpen && <Paywall onClose={() => setPaywallOpen(false)} />}

      {updateOffer && (
        <UpdateModal
          version={updateOffer.version}
          installing={updateInstalling}
          error={updateError}
          onClose={() => setUpdateOffer(null)}
          onUpdate={() => void handleInstallUpdate()}
        />
      )}

      {trayToast && <div className="toast">{trayToast}</div>}
    </div>
  );
}

async function closeWindow() {
  if (!isDesktop) return;
  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(0);
}

function WindowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="rail-win-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function RailTab({
  id,
  label,
  active,
  onClick,
  children,
}: {
  id: TabId;
  label: string;
  active: boolean;
  onClick: (id: TabId) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`rail-tab ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => onClick(id)}
    >
      {children}
    </button>
  );
}

/** The square coral record control that lives in the Studio header. */
function RecordControl() {
  const {
    recording,
    finalizing,
    arming,
    promoMode,
    promoInnerActive,
    startRecording,
    stopRecording,
    cancelRecordingCountdown,
    cancelPromoSession,
  } = useStore();

  const promoUsageOnly = Boolean(promoMode) && recording && !promoInnerActive && !arming;

  if (arming && promoMode) {
    return (
      <button
        type="button"
        className="rec-btn"
        title="Cancel promo recording"
        aria-label="Cancel promo recording"
        onClick={() => cancelPromoSession()}
      >
        <CloseIcon size={22} />
      </button>
    );
  }

  if (arming) {
    return (
      <button
        type="button"
        className="rec-btn"
        title="Cancel countdown"
        aria-label="Cancel countdown"
        onClick={() => cancelRecordingCountdown()}
      >
        <CloseIcon size={22} />
      </button>
    );
  }

  if (promoUsageOnly) {
    return (
      <button
        type="button"
        className="rec-btn"
        title="Start nested take"
        aria-label="Start nested take"
        onClick={() => startRecording()}
      >
        REC
      </button>
    );
  }

  if (recording || finalizing) {
    return (
      <button
        type="button"
        className="rec-btn"
        disabled={finalizing}
        title={finalizing ? "Saving…" : "Stop recording"}
        aria-label="Stop recording"
        onClick={() => stopRecording()}
      >
        <StopIcon size={20} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="rec-btn"
      title="Record"
      aria-label="Record"
      onClick={() => startRecording()}
    >
      REC
    </button>
  );
}

const SAVE_PHASE_LABELS: Record<string, string> = {
  starting: "Preparing…",
  finalizing: "Finalizing video…",
  audio: "Mixing audio…",
  timing: "Aligning audio & video…",
  encrypting: "Encrypting & saving…",
};

/** Temporary panel shown while a stopped recording is being saved. */
function Processing() {
  const { saveProgress, savePhase } = useStore();
  const pct = Math.max(0, Math.min(100, Math.round(saveProgress)));
  const label = SAVE_PHASE_LABELS[savePhase] ?? "Processing…";

  return (
    <div className="scroll pad">
      <div className="proc">
        <div className="proc-spinner" aria-hidden />
        <div className="proc-label">{label}</div>
        <div className="proc-bar">
          <div className="proc-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="proc-pct">{pct}%</div>
        <p className="proc-hint">Keep this window open — your take will appear in the Library.</p>
      </div>
    </div>
  );
}

/** Cross-fades panel content whenever the active tab changes. */
function TabbedBody({ tab }: { tab: TabId }) {
  const [shown, setShown] = useState<TabId>(tab);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const pending = useRef<TabId>(tab);
  const [libraryMounted, setLibraryMounted] = useState(tab === "preview");

  useEffect(() => {
    if (tab === "preview") setLibraryMounted(true);
  }, [tab]);

  useEffect(() => {
    if (tab === shown) return;
    pending.current = tab;
    setPhase("out");
    const t = window.setTimeout(() => {
      setShown(pending.current);
      setPhase("in");
    }, 160);
    return () => window.clearTimeout(t);
  }, [tab, shown]);

  return (
    <div className="panel-body">
      <div className={`pb-anim ${phase}`}>
        {libraryMounted ? (
          <div className="tab-pane" hidden={shown !== "preview"}>
            <Preview />
          </div>
        ) : null}
        {shown === "studio" ? (
          <Studio />
        ) : shown === "preview" ? null : shown === "hotkeys" ? (
          <Hotkeys />
        ) : shown === "account" ? (
          <Account />
        ) : (
          <Info />
        )}
      </div>
    </div>
  );
}
