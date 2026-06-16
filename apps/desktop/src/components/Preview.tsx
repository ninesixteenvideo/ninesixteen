import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";
import { invoke, isDesktop } from "../lib/bridge";
import { ensureDriveToken } from "../lib/driveAuth";
import { isOnline } from "../lib/entitlementCache";
import type { RecordingInfo } from "../lib/types";
import {
  CloudIcon,
  ExportIcon,
  FolderIcon,
  LibraryIcon,
  LockIcon,
  PlayIcon,
  TrashIcon,
} from "./icons";
import { RecThumb } from "./RecThumb";

type ExportKind = "local" | "drive";
type CardMode = "default" | "export" | "delete" | "rename";

/**
 * The Library tab is a pure vertical file browser. Selecting a take drives the
 * shared store; the actual 9×16 player lives in <FilmDock /> at the shell level
 * so it can slide out from behind the sidebar.
 */
export function Preview() {
  const {
    recordings,
    deleteRecording,
    renameRecording,
    librarySelectedId,
    setLibrarySelected,
    setPaywallOpen,
  } = useStore();
  const { isPro, getIdToken } = useAuth();

  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [cardMode, setCardMode] = useState<CardMode>("default");
  const [renameDraft, setRenameDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const driveExportRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const selectedId = librarySelectedId;
  const selected = recordings.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !recordings.some((r) => r.id === selectedId)) {
      setLibrarySelected(null);
    }
  }, [recordings, selectedId, setLibrarySelected]);

  useEffect(() => {
    setCardMode("default");
    setRenameDraft("");
  }, [selectedId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || cardMode === "default") return;
      setCardMode("default");
      setRenameDraft("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cardMode]);

  useEffect(() => {
    if (cardMode !== "rename") return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [cardMode]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  function openRename(rec: RecordingInfo) {
    setRenameDraft(displayBaseName(rec.filename));
    setCardMode("rename");
  }

  async function confirmRename(rec: RecordingInfo) {
    const next = renameDraft.trim();
    if (!next) {
      showToast("Enter a name");
      return;
    }
    try {
      await renameRecording(rec.id, next);
      setCardMode("default");
      setRenameDraft("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Rename failed");
    }
  }

  function openExport() {
    if (!isPro) {
      setPaywallOpen(true);
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
      const defaultName = rec.filename.replace(/\.ns$/i, ".mp4");
      const dest = await save({
        defaultPath: defaultName,
        filters: [{ name: "MP4 video", extensions: ["mp4"] }],
        title: "Save recording as",
      });
      if (!dest) return;
      await invoke("export_recording", { id: rec.id, dest, idToken });
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
        if (!msg.toLowerCase().includes("timed out")) showToast(msg);
      } finally {
        if (driveExportRef.current === rec.id) driveExportRef.current = null;
      }
    })();
  }

  async function confirmDelete(id: string) {
    await deleteRecording(id);
    setCardMode("default");
  }

  if (recordings.length === 0) {
    return (
      <div className="library">
        <div className="lib-empty">
          <span className="glyph">
            <LibraryIcon size={26} />
          </span>
          <p className="muted">No recordings yet. Hit Record in the Studio.</p>
        </div>
      </div>
    );
  }

  const busy = exporting !== null;

  return (
    <>
      <div className="scroll pad">
        <div className="browser">
          {recordings.map((rec) =>
            rec.id === selectedId && selected ? (
              <div key={rec.id} className="rec-item selected">
                <Actions
                  key={cardMode}
                  mode={cardMode}
                  busy={busy}
                  isPro={isPro}
                  exporting={exporting}
                  renameDraft={renameDraft}
                  renameInputRef={renameInputRef}
                  onRenameDraftChange={setRenameDraft}
                  onRename={() => openRename(selected)}
                  onConfirmRename={() => void confirmRename(selected)}
                  onDelete={() => setCardMode("delete")}
                  onExport={openExport}
                  onExportDrive={() => startDriveExport(selected)}
                  onExportLocal={() => runLocalExport(selected)}
                  onCancel={() => {
                    setCardMode("default");
                    setRenameDraft("");
                  }}
                  onConfirmDelete={() => confirmDelete(selected.id)}
                />
              </div>
            ) : (
              <button
                key={rec.id}
                type="button"
                className="rec-item"
                onClick={() => setLibrarySelected(rec.id)}
                title={rec.filename}
              >
                <RecThumb id={rec.id} orientation={rec.orientation} />
                <span className="rec-info">
                  <span className="rec-name">{rec.filename}</span>
                  <span className="rec-spec">
                    {fmtDur(rec.duration)} · {fmtMb(rec.size_bytes)} ·{" "}
                    {new Date(rec.created_at).toLocaleDateString()}
                  </span>
                </span>
                <span className="rec-play">
                  <PlayIcon size={16} />
                </span>
              </button>
            )
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

type ActionsProps = {
  mode: CardMode;
  busy: boolean;
  isPro: boolean;
  exporting: ExportKind | null;
  renameDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onRenameDraftChange: (value: string) => void;
  onRename: () => void;
  onConfirmRename: () => void;
  onDelete: () => void;
  onExport: () => void;
  onExportDrive: () => void;
  onExportLocal: () => void;
  onCancel: () => void;
  onConfirmDelete: () => void;
};

function Actions({
  mode,
  busy,
  isPro,
  exporting,
  renameDraft,
  renameInputRef,
  onRenameDraftChange,
  onRename,
  onConfirmRename,
  onDelete,
  onExport,
  onExportDrive,
  onExportLocal,
  onCancel,
  onConfirmDelete,
}: ActionsProps) {
  if (mode === "rename") {
    return (
      <div className="acts acts-rename">
        <div className="acts-rename-fields">
          <input
            ref={renameInputRef}
            className="act-input"
            value={renameDraft}
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirmRename();
            }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Recording name"
          />
          <button className="act act-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
        <button className="act primary act-save" onClick={onConfirmRename} disabled={busy}>
          Save
        </button>
      </div>
    );
  }

  if (mode === "export") {
    return (
      <div className="acts">
        <button className="act" onClick={onExportDrive} disabled={busy}>
          <CloudIcon size={17} /> Drive
        </button>
        <button className="act" onClick={onExportLocal} disabled={busy}>
          {exporting === "local" ? (
            "Saving…"
          ) : (
            <>
              <FolderIcon size={17} /> Disk
            </>
          )}
        </button>
        <button className="act" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    );
  }

  if (mode === "delete") {
    return (
      <div className="acts">
        <span className="act-q">Delete this take?</span>
        <button className="act" onClick={onCancel} disabled={busy}>
          Keep
        </button>
        <button className="act primary" onClick={onConfirmDelete} disabled={busy}>
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="acts acts-main">
      <button className="act" onClick={onRename} disabled={busy} title="Rename this recording">
        Rename
      </button>
      <button className="act" onClick={onDelete} disabled={busy} title="Delete this recording">
        <TrashIcon size={16} /> Delete
      </button>
      <button
        className="act primary"
        onClick={onExport}
        disabled={busy}
        title={isPro ? "Export recording" : "Buy Pro to export"}
      >
        {isPro ? <ExportIcon size={16} /> : <LockIcon size={14} />} Export
      </button>
    </div>
  );
}

function displayBaseName(filename: string) {
  return filename.replace(/\.(mp4|ns)$/i, "");
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
