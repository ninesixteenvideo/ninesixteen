import { useStore } from "../state/store";

export function CamStatus() {
  const { cameraEnabled, cameraConnected, recording } = useStore();

  const status = !cameraEnabled
    ? {
        label: "Unavailable",
        hint: "Virtual camera could not start. Check the log in your Videos folder.",
        tone: "off" as const,
      }
    : cameraConnected
      ? {
          label: recording ? "Live · recording" : "Live",
          hint: recording
            ? "Your 9×16 stream is active while you record."
            : "An app is receiving your ninesixteen.video feed.",
          tone: "live" as const,
        }
      : {
          label: "Ready",
          hint: 'Pick "ninesixteen.video" in OBS, Twitch, Zoom, or your browser.',
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
