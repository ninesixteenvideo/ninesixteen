import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";
import { invoke, isDesktop, mediaSrc } from "../lib/bridge";
import type { RecordingInfo } from "../lib/types";
import { Paywall } from "./Paywall";

export function Preview() {
  const { recordings, deleteRecording } = useStore();
  const { isPro } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [srcMap, setSrcMap] = useState<Record<string, string>>({});
  const [showPaywall, setShowPaywall] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Keep a valid selection as the list changes.
  useEffect(() => {
    if (recordings.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(recordings[0].id);
    }
  }, [recordings, selectedId]);

  // Resolve asset-protocol URLs for every recording path.
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

  async function onExport(rec: RecordingInfo) {
    if (!isPro) {
      setShowPaywall(true);
      return;
    }
    if (!isDesktop) {
      setToast("Export works in the desktop app.");
      return;
    }
    setExporting(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        defaultPath: rec.filename,
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      });
      if (!dest) return;
      await invoke("export_recording", { id: rec.id, dest });
      showToast("Exported ✓");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
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
            <div key={r.id} className="preview-item active preview-item-actions">
              <button
                className="card-action delete"
                onClick={() => deleteRecording(r.id)}
                title="Delete this recording"
              >
                Delete
              </button>
              <button
                className="card-action export"
                onClick={() => onExport(r)}
                disabled={exporting}
                title={isPro ? "Export to MP4" : "Subscribe to export"}
              >
                {exporting ? "…" : isPro ? "Export" : "Export 🔒"}
              </button>
            </div>
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

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
