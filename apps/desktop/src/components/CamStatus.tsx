import { useStore } from "../state/store";

export function CamStatus() {
  const { cameraEnabled, cameraConnected, recording } = useStore();

  const status = !cameraEnabled
    ? {
        label: "Unavailable",
        hint: "Virtual camera did not start. Check ~/Videos/ninesixteen/ninesixteen.log — if registration failed, run scripts/register-softcam.bat as Administrator once, then restart.",
        tone: "off" as const,
      }
    : cameraConnected
      ? {
          label: recording ? "In use · recording" : "In use",
          hint: recording
            ? "Another app is receiving your framed 9×16 feed while you record."
            : "Another app is receiving your ninesixteen.video camera feed.",
          tone: "live" as const,
        }
      : {
          label: "Ready",
          hint: "Pick ninesixteen.video in any app that lists camera devices. Keep this app running. First time on this PC? Run scripts/register-softcam.bat as Administrator once.",
          tone: "ready" as const,
        };

  return (
    <div className="cam-wrap">
      <span className={`pill cam-pill ${status.tone}`} tabIndex={0}>
        CAM
      </span>
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
