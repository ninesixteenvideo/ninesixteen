import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";
import { invoke, isDesktop, mediaSrc } from "../lib/bridge";
import { ensureDriveToken } from "../lib/driveAuth";
import type { RecordingInfo } from "../lib/types";
import { Paywall } from "./Paywall";

type ExportKind = "local" | "drive";
type CardMode = "default" | "export" | "delete";

export function Preview() {
  const { recordings, deleteRecording } = useStore();
  const { isPro } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [srcMap, setSrcMap] = useState<Record<string, string>>({});
  const [showPaywall, setShowPaywall] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [cardMode, setCardMode] = useState<CardMode>("default");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (recordings.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(recordings[0].id);
    }
  }, [recordings, selectedId]);

  useEffect(() => {
    setCardMode("default");
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
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        recordings.map(async (r) => [r.id, await mediaSrc(r.id)] as const)
      );
      if (!cancelled) setSrcMap(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [recordings]);

  const selected = useMemo(
    () => recordings.find((r) => r.id === selectedId) ?? null,
    [recordings, selectedId]
  );

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
      const dest = await invoke<string>("export_recording_local", { id: rec.id });
      showToast(`Saved to ${dest}`);
      setCardMode("default");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  function startDriveExport(rec: RecordingInfo) {
    setCardMode("default");
    showToast("Google Drive export started — finish sign-in in your browser if prompted.");

    void (async () => {
      try {
        const token = await ensureDriveToken();
        const link = await invoke<string>("export_recording_to_drive", {
          id: rec.id,
          accessToken: token,
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
          <h3 className="preview-heading">Preview</h3>
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
            Preview <span className="muted">({recordings.length})</span>
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
                {srcMap[r.id] ? (
                  <video src={srcMap[r.id]} muted preload="metadata" />
                ) : (
                  <span className="muted">{r.orientation === "portrait" ? "9×16" : "16×9"}</span>
                )}
              </span>
              <span className="preview-item-meta">
                <b>{r.filename}</b>
                <span className="muted">
                  {fmtDur(r.duration)} · {(r.size_bytes / 1e6).toFixed(1)} MB
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
                  style={{
                    aspectRatio: selected.orientation === "portrait" ? "9 / 16" : "16 / 9",
                  }}
                />
              ) : (
                <div className="preview-player loading">Loading…</div>
              )}
            </div>

            <div className="preview-meta-bar">
              <div className="preview-meta-info">
                <b>{selected.filename}</b>
                <div className="muted">
                  {selected.width}×{selected.height} · {fmtDur(selected.duration)} ·{" "}
                  {(selected.size_bytes / 1e6).toFixed(1)} MB ·{" "}
                  {new Date(selected.created_at).toLocaleString()}
                </div>
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
                <LocalFileGlyph />
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
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#3777e3" d="M6.75 3.25 1.5 12l5.25 8.75h10.5L22.5 12 17.25 3.25z" />
      <path fill="#ffcf63" d="M6.75 3.25h10.5L17.25 12H6.75z" />
      <path fill="#11a861" d="M1.5 12h10.5L8.25 20.75H1.5z" />
    </svg>
  );
}

function LocalFileGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9.5L14.5 2z"
        opacity="0.2"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 2v7h7M8 13h8M8 17h6"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 16 2 2 4-4"
      />
    </svg>
  );
}

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
