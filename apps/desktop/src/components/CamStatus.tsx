import { useState } from "react";
import { useStore } from "../state/store";

export function CamStatus() {
  const { cameraEnabled, cameraConnected, recording, startCamera } = useStore();
  const [starting, setStarting] = useState(false);

  async function enableCamera() {
    if (cameraEnabled || starting) return;
    setStarting(true);
    try {
      await startCamera();
    } catch {
      /* error surfaced via store.error */
    } finally {
      setStarting(false);
    }
  }

  const status = !cameraEnabled
    ? starting
      ? {
          label: "Starting…",
          hint: "Registering ninesixteen.video — this runs only when you turn the camera on.",
          tone: "off" as const,
        }
      : {
          label: "Off",
          hint: "Click CAM to enable the virtual camera for OBS, Zoom, etc. First time on this PC? Run scripts/register-softcam.bat as Administrator once.",
          tone: "off" as const,
        }
    : cameraConnected
      ? {
          label: recording ? "In use · recording" : "In use",
          hint: recording
            ? "Virtual camera feed pauses while you record."
            : "Another app is receiving your ninesixteen.video camera feed.",
          tone: "live" as const,
        }
      : {
          label: "Ready",
          hint: "Pick ninesixteen.video in OBS, Zoom, or any camera app. Screen capture starts when that app opens the camera.",
          tone: "ready" as const,
        };

  return (
    <div className="cam-wrap">
      <button
        type="button"
        className={`pill cam-pill ${status.tone}`}
        onClick={() => void enableCamera()}
        disabled={cameraEnabled || starting}
        title={status.hint}
      >
        CAM
      </button>
      <div className="cam-pop" role="tooltip">
        <div className="cam-pop-head">
          <span className={`cam-dot ${status.tone}`} aria-hidden />
          <div>
            <b>ninesixteen.video</b>
            <span className="cam-pop-status">{status.label}</span>
          </div>
        </div>
        <p className="cam-pop-hint">{status.hint}</p>
      </div>
    </div>
  );
}
