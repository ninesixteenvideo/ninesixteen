import { useStore } from "../state/store";
import { isDesktop } from "../lib/bridge";

export function Settings() {
  const {
    inputSettings,
    recordingSettings,
    monitors,
    monitor,
    setInputSettings,
    setRecordingSettings,
  } = useStore();

  return (
    <div className="content scroll" style={{ maxWidth: 760, margin: "0 auto" }}>
      {!isDesktop && (
        <div className="banner" style={{ marginBottom: 16 }}>
          Web preview — capture runs only in the desktop build.
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Zoom</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Hold <span className="kbd">Alt</span> and scroll to zoom. Pauses for 1s at full 9×16 so
          you can land there easily; scroll out further to see the whole desktop letterboxed.
        </p>
        <Slider
          label="Scroll sensitivity"
          value={inputSettings.zoomSensitivity}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => setInputSettings({ zoomSensitivity: v })}
        />
      </section>

      <section className="panel">
        <h3>Recording &amp; camera</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Record saves a file you can browse in Preview. The virtual camera starts automatically — choose{" "}
          <b>ninesixteen.video</b> as the video source in your streaming app or browser.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="label">Source display</span>
          <span className="muted">
            {monitor?.name ?? monitors[0]?.name ?? "—"} ({monitor?.width}×{monitor?.height})
          </span>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="label">Resolution</span>
          <div className="seg">
            {([720, 1080, 1440] as const).map((q) => (
              <button
                key={q}
                className={recordingSettings.quality === q ? "on" : ""}
                onClick={() => setRecordingSettings({ quality: q })}
              >
                {`${q}p`}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="label">Frame rate</span>
          <div className="seg">
            {([30, 60] as const).map((f) => (
              <button
                key={f}
                className={recordingSettings.fps === f ? "on" : ""}
                onClick={() => setRecordingSettings({ fps: f })}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="label">Capture cursor</span>
          <Toggle
            label={recordingSettings.captureCursor ? "On" : "Off"}
            on={recordingSettings.captureCursor}
            onClick={() =>
              setRecordingSettings({ captureCursor: !recordingSettings.captureCursor })
            }
          />
        </div>
      </section>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="row">
        <span className="label">{label}</span>
        <span className="muted">{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`btn sm ${on ? "blue" : "ghost"}`} onClick={onClick}>
      {label}
    </button>
  );
}
