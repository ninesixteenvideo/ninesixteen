import { useEffect, useRef, useState } from "react";
import { RailWordmark } from "./components/RailWordmark";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { useStore } from "./state/store";
import { useAuth } from "./lib/auth";
import { Studio } from "./components/Studio";
import { Preview } from "./components/Preview";
import { FilmDock } from "./components/FilmDock";
import { Account } from "./components/Account";
import { Info } from "./components/Info";
import { Hotkeys } from "./components/Hotkeys";
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

/** Must match the .film slide transition duration in styles.css. */
const FILM_SLIDE_MS = 520;

export function App() {
  const {
    ready,
    tab,
    setTab,
    init,
    recording,
    arming,
    finalizing,
    librarySelectedId,
    setLibrarySelected,
    paywallOpen,
    setPaywallOpen,
    recordingSettings,
    recordings,
  } = useStore();
  const { isPro } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [filmExtended, setFilmExtended] = useState(false);
  const [updateOffer, setUpdateOffer] = useState<{ version: string } | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Live capture = countdown or recording: the overlay owns the desktop, so the
  // dock hides entirely. Finalizing is different — we keep the dock on screen and
  // surface a "Processing" panel so the user knows their take is being saved.
  const liveCapture = recording || arming;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const restoreExpanded = useRef(expanded);

  const selectedRecording = recordings.find((r) => r.id === librarySelectedId);
  const filmOrientation =
    selectedRecording?.orientation ?? recordingSettings.orientation;

  const { sidebarPx } = useDockLayout({
    ready,
    expanded,
    capturing: liveCapture,
    libraryTab: tab === "preview",
    filmSelected: !!librarySelectedId,
    filmVisible: filmExtended,
    filmOrientation,
  });

  useEffect(() => {
    if (liveCapture) {
      restoreExpanded.current = expandedRef.current;
      setExpanded(false);
      setLibrarySelected(null);
    }
  }, [liveCapture, setLibrarySelected]);

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

  function retractFilmThen(action: () => void) {
    if (tab === "preview" && librarySelectedId) {
      setLibrarySelected(null);
      window.setTimeout(action, FILM_SLIDE_MS);
      return true;
    }
    return false;
  }

  function openTab(id: TabId) {
    if (id === tab) {
      if (!expanded) setExpanded(true);
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
  const formatSub =
    recordingSettings.orientation === "landscape"
      ? "Frame your shot, then record in true 16×9."
      : "Frame your shot, then record in true 9×16.";
  const headings: Record<TabId, { title: string; sub: string }> = {
    studio: { title: "Studio", sub: formatSub },
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
        className={`sidebar ${expanded ? "expanded" : "collapsed"} ${liveCapture ? "capturing" : ""}`}
      >
        <nav className="rail" aria-label="Primary">
          <div className="rail-win">
            <WindowButton label="Close" onClick={() => void closeWindow()}>
              <CloseIcon size={16} />
            </WindowButton>
            <WindowButton label="Minimize" onClick={() => void minimizeWindow()}>
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
              <p className="panel-sub">
                {finalizing ? "Saving your recording — hang tight." : headings[tab as TabId].sub}
              </p>
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

      <FilmDock onExtendedChange={setFilmExtended} />

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
    </div>
  );
}

async function minimizeWindow() {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
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
  const { recording, finalizing, arming, startRecording, stopRecording, cancelRecordingCountdown } =
    useStore();

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
        {shown === "studio" ? (
          <Studio />
        ) : shown === "preview" ? (
          <Preview />
        ) : shown === "hotkeys" ? (
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
