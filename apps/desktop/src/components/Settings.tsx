import { useStore } from "../state/store";
import { isDesktop } from "../lib/bridge";
import { WEB_URL } from "../lib/firebase";

async function openLegalPage(path: "/terms" | "/privacy") {
  const url = `${WEB_URL}${path}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function Settings() {
  const {
    inputSettings,
    monitors,
    monitor,
    setInputSettings,
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
        <h3>Recording</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Recordings save as encrypted files you can preview in the app. Pro unlocks MP4 export.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="label">Source display</span>
          <span className="muted">
            {monitor?.name ?? monitors[0]?.name ?? "—"} ({monitor?.width}×{monitor?.height})
          </span>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h3>Legal</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Terms of Use and Privacy Policy for {isDesktop ? "the desktop app and" : ""} the
          ninesixteen.video website. Contact{" "}
          <a href="mailto:dev@ninesixteen.video">dev@ninesixteen.video</a> with questions.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => openLegalPage("/terms")}>
            Terms of Use
          </button>
          <button className="btn ghost sm" onClick={() => openLegalPage("/privacy")}>
            Privacy Policy
          </button>
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
