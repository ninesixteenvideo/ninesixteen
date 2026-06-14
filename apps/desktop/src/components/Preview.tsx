import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";
import { invoke, isDesktop, mediaSrc } from "../lib/bridge";
import { ensureDriveToken } from "../lib/driveAuth";
import { isOnline } from "../lib/entitlementCache";
import type { RecordingInfo } from "../lib/types";
import { Paywall } from "./Paywall";

type ExportKind = "local" | "drive";
type CardMode = "default" | "export" | "delete";

export function Preview() {
  const { recordings, deleteRecording } = useStore();
  const { isPro, getIdToken } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [srcMap, setSrcMap] = useState<Record<string, string>>({});
  const [showPaywall, setShowPaywall] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [cardMode, setCardMode] = useState<CardMode>("default");
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const driveExportRef = useRef<string | null>(null);

  useEffect(() => {
    if (recordings.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(recordings[0].id);
    }
  }, [recordings, selectedId]);

  useEffect(() => {
    setCardMode("default");
    setPlaybackError(null);
  }, [selectedId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || cardMode === "default") return;
      setCardMode("default");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cardMode]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void (async () => {
      const src = await mediaSrc(selectedId);
      if (!cancelled) {
        setSrcMap((prev) => (prev[selectedId] === src ? prev : { ...prev, [selectedId]: src }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => recordings.find((r) => r.id === selectedId) ?? null,
    [recordings, selectedId]
  );

  const sectionTitle = isPro ? "Library" : "Preview";

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  function openExport() {
    if (!isPro) {
      setShowPaywall(true);
      return;
    }
    if (!isDesktop) {
      setToast("Export works in the desktop app.");
      return;
    }
    setCardMode("export");
  }

  async function runLocalExport(rec: RecordingInfo) {
    setExporting("local");
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        showToast("Sign in required to export");
        return;
      }
      const dest = await invoke<string>("export_recording_local", {
        id: rec.id,
        idToken,
      });
      showToast(`Saved to ${dest}`);
      setCardMode("default");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  function startDriveExport(rec: RecordingInfo) {
    if (!isOnline()) {
      showToast("Google Drive export requires an internet connection.");
      return;
    }
    if (driveExportRef.current === rec.id) {
      showToast("Google Drive export already in progress…");
      return;
    }

    setCardMode("default");
    showToast("Google Drive export started — finish sign-in in your browser if prompted.");
    driveExportRef.current = rec.id;

    void (async () => {
      try {
        const idToken = await getIdToken();
        if (!idToken) {
          showToast("Sign in required to export");
          return;
        }
        const token = await ensureDriveToken();
        showToast("Uploading to Google Drive…");
        const link = await invoke<string>("export_recording_to_drive", {
          id: rec.id,
          accessToken: token,
          idToken,
        });
        showToast("Uploaded to Google Drive ✓");
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(link);
        } catch {
          /* optional */
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Drive export failed";
        if (!msg.toLowerCase().includes("timed out")) {
          showToast(msg);
        }
      } finally {
        if (driveExportRef.current === rec.id) {
          driveExportRef.current = null;
        }
      }
    })();
  }

  async function confirmDelete(id: string) {
    await deleteRecording(id);
    setCardMode("default");
  }

  if (recordings.length === 0) {
    return (
      <div className="content">
        <div className="row" style={{ marginBottom: 16 }}>
          <h3 className="preview-heading">{sectionTitle}</h3>
        </div>
        <div className="empty" style={{ minHeight: 320 }}>
          <span style={{ fontSize: 40 }}>🎬</span>
          <p className="muted">No recordings yet. Hit Record in the Studio.</p>
        </div>
      </div>
    );
  }

  const busy = exporting !== null;

  return (
    <div className="preview">
      <aside className="preview-list scroll">
        <div className="row preview-list-head">
          <h3 className="preview-heading">
            {sectionTitle} <span className="muted">({recordings.length})</span>
          </h3>
        </div>
        {recordings.map((r) =>
          r.id === selectedId ? (
            <SelectedRecordingCard
              key={r.id}
              mode={cardMode}
              busy={busy}
              isPro={isPro}
              exporting={exporting}
              onDelete={() => setCardMode("delete")}
              onExport={openExport}
              onExportDrive={() => startDriveExport(r)}
              onExportLocal={() => runLocalExport(r)}
              onCancelDelete={() => setCardMode("default")}
              onConfirmDelete={() => confirmDelete(r.id)}
            />
          ) : (
            <button
              key={r.id}
              className="preview-item"
              onClick={() => setSelectedId(r.id)}
            >
              <span
                className="preview-thumb"
                style={{ aspectRatio: r.orientation === "portrait" ? "9 / 16" : "16 / 9" }}
              >
                <span className="muted">{r.orientation === "portrait" ? "9×16" : "16×9"}</span>
              </span>
              <span className="preview-item-meta">
                <b>{r.filename}</b>
                <span className="muted">
                  {fmtDur(r.duration)} · {fmtMb(r.size_bytes)}
                </span>
              </span>
            </button>
          )
        )}
      </aside>

      <section className="preview-stage">
        {selected && (
          <>
            <div className="preview-player-wrap">
              {srcMap[selected.id] ? (
                <video
                  key={selected.id}
                  className="preview-player"
                  src={srcMap[selected.id]}
                  controls
                  autoPlay
                  onError={() =>
                    setPlaybackError(
                      "Could not load this recording. Rebuild the app if playback recently broke — the release CSP must allow https://nsmedia.localhost."
                    )
                  }
                  style={{
                    aspectRatio: selected.orientation === "portrait" ? "9 / 16" : "16 / 9",
                  }}
                />
              ) : (
                <div className="preview-player loading">Loading…</div>
              )}
            </div>

            {playbackError && <p className="auth-error">{playbackError}</p>}

            <div className="preview-meta-bar">
              <div className="preview-meta-info">
                <b>{selected.filename}</b>
                <div className="muted">
                  {selected.width}×{selected.height} · {fmtDur(selected.duration)} ·{" "}
                  {fmtMb(selected.size_bytes)} ·{" "}
                  {new Date(selected.created_at).toLocaleString()}
                </div>
                {!isPro && (
                  <div className="preview-cap-note">
                    Preview limited to 15 seconds ·{" "}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setShowPaywall(true)}
                    >
                      Upgrade for full playback &amp; export
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {toast && <div className="toast">{toast}</div>}
      {showPaywall && <Paywall onClose={() => setShowPaywall(false)} />}
    </div>
  );
}

type SelectedRecordingCardProps = {
  mode: CardMode;
  busy: boolean;
  isPro: boolean;
  exporting: ExportKind | null;
  onDelete: () => void;
  onExport: () => void;
  onExportDrive: () => void;
  onExportLocal: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function SelectedRecordingCard({
  mode,
  busy,
  isPro,
  exporting,
  onDelete,
  onExport,
  onExportDrive,
  onExportLocal,
  onCancelDelete,
  onConfirmDelete,
}: SelectedRecordingCardProps) {
  return (
    <div className="preview-item active preview-item-actions">
      <div className={`card-action-panel card-action-panel--${mode}`}>
        {mode === "default" && (
          <div className="card-action-slide" key="default">
            <button
              className="card-action delete"
              onClick={onDelete}
              disabled={busy}
              title="Delete this recording"
            >
              Delete
            </button>
            <button
              className="card-action export"
              onClick={onExport}
              disabled={busy}
              title={isPro ? "Export recording" : "Subscribe to export"}
            >
              Export{!isPro ? " 🔒" : ""}
            </button>
          </div>
        )}

        {mode === "export" && (
          <div className="card-action-slide" key="export">
            <button
              className="card-action drive icon-only"
              onClick={onExportDrive}
              disabled={busy}
              title="Save to Google Drive"
              aria-label="Save to Google Drive"
            >
              <GoogleDriveGlyph />
            </button>
            <button
              className="card-action local icon-only"
              onClick={onExportLocal}
              disabled={busy}
              title="Save to Documents/Videos"
              aria-label="Save locally to Documents/Videos"
            >
              {exporting === "local" ? (
                <span className="card-action-spinner" aria-hidden="true" />
              ) : (
                <LocalFolderGlyph />
              )}
            </button>
          </div>
        )}

        {mode === "delete" && (
          <div className="card-action-slide card-action-confirm" key="delete">
            <p className="card-action-question">Are you sure?</p>
            <div className="card-action-row">
              <button
                className="card-action cancel"
                onClick={onCancelDelete}
                disabled={busy}
              >
                No
              </button>
              <button
                className="card-action confirm"
                onClick={onConfirmDelete}
                disabled={busy}
              >
                Yes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleDriveGlyph() {
  return (
    <svg
      className="card-action-glyph card-action-glyph--drive"
      viewBox="0 0 87.3 78"
      aria-hidden="true"
    >
      <path
        fill="#0066DA"
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.24l13.75-23.8h-27.5c0 1.55.4 3.04 1.15 4.35z"
      />
      <path
        fill="#00AC47"
        d="m43.65 25-13.75-23.8c-1.35.74-2.5 1.84-3.3 3.24l-25.4 44a9.06 9.06 0 0 0-1.15 4.35h27.5z"
      />
      <path
        fill="#EA4335"
        d="m73.55 76.8c1.35-.74 2.5-1.84 3.3-3.24l1.6-2.75 7.65-13.25c.75-1.3 1.15-2.8 1.15-4.35h-27.502l5.925 10.25z"
      />
      <path
        fill="#00832D"
        d="m43.65 25 13.75-23.8c-1.35-.74-2.8-1.15-4.35-1.15h-18.85c-1.55 0-3 .41-4.25 1.15l-13.75 23.8z"
      />
      <path
        fill="#2684FC"
        d="m59.8 53h-32.3l-13.75 23.8c1.25.75 2.7 1.15 4.25 1.15h46.85c1.55 0 3-.41 4.25-1.15z"
      />
      <path
        fill="#FFBA00"
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.24l-13.75 23.8 16.15 23.25z"
      />
    </svg>
  );
}

function LocalFolderGlyph() {
  return (
    <svg
      className="card-action-glyph card-action-glyph--folder"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#F9A825"
        d="M3 7v11c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2h-7.5L9 5H5C3.9 5 3 5.9 3 7z"
      />
      <path fill="#FBC02D" d="M3 7c0-1.1.9-2 2-2h3.5L11 7H3z" />
      <path fill="#FFEB3B" d="M5 10h14v8H5z" opacity="0.45" />
    </svg>
  );
}

function fmtMb(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "— MB";
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
