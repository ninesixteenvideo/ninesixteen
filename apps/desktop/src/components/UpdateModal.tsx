import { useEffect } from "react";
import { CloseIcon } from "./icons";

type Props = {
  version: string;
  installing: boolean;
  error: string | null;
  onClose: () => void;
  onUpdate: () => void;
};

export function UpdateModal({ version, installing, error, onClose, onUpdate }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !installing) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, installing]);

  return (
    <div className="scrim" onClick={installing ? undefined : onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="update-title"
      >
        {!installing && (
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        )}

        <span className="badge">Update</span>
        <h2 id="update-title" className="dialog-title">
          Version {version} is available
        </h2>
        <p className="dialog-sub">
          {installing
            ? "Downloading and installing the update. The app will restart when it's ready."
            : "A newer version of ninesixteen.video is ready. Update now to get the latest fixes and improvements."}
        </p>

        {error && <p className="auth-err" style={{ marginTop: 12 }}>{error}</p>}

        <div className="dialog-actions">
          {!installing && (
            <button type="button" className="btn ghost" onClick={onClose}>
              Later
            </button>
          )}
          <button type="button" className="btn primary" disabled={installing} onClick={onUpdate}>
            {installing ? "Updating…" : "Update now"}
          </button>
        </div>
      </div>
    </div>
  );
}
