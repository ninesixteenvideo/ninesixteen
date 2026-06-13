import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import type { AudioSourceMode } from "../lib/types";

const SOURCE_OPTIONS: { id: AudioSourceMode; label: string; hint: string }[] = [
  { id: "none", label: "No audio", hint: "Video only" },
  { id: "system", label: "System audio", hint: "Games, browser & apps" },
  { id: "microphone", label: "Microphone", hint: "Your voice or external mic" },
  { id: "system_and_microphone", label: "System + mic", hint: "Desktop audio and voice" },
];

export function Studio() {
  const {
    recording,
    finalizing,
    arming,
    countdownSeconds,
    elapsed,
    error,
    startRecording,
    cancelRecordingCountdown,
    stopRecording,
    overlayVisible,
    setOverlayVisible,
    audioSettings,
    audioDevices,
    audioLevels,
    setAudioSettings,
    markAudioCalibrated,
    canRecord,
  } = useStore();

  const sessionActive = recording || finalizing || arming;
  const wantsSystem =
    audioSettings.source === "system" || audioSettings.source === "system_and_microphone";
  const wantsMic =
    audioSettings.source === "microphone" || audioSettings.source === "system_and_microphone";
  const micDevices = audioDevices.filter((d) => d.kind === "microphone");
  const hasAudio = audioSettings.source !== "none";
  const needsCalibration = hasAudio && !audioSettings.calibrated;

  const statusTitle = arming
    ? `Get ready — ${countdownSeconds || "…"}`
    : finalizing
      ? "Saving recording…"
      : recording
        ? "Recording"
        : "Ready to record";

  const statusBody = arming
    ? "Frame is on your desktop — Alt + scroll to zoom, move the mouse to position. Capture starts when the countdown ends."
    : finalizing
      ? "Writing the MP4 — almost done."
      : recording
        ? `Recording ${formatDuration(elapsed)}`
        : "Press Record — you'll get 5 seconds to frame your shot first.";

  return (
    <div className="content scroll studio-panel">
      <section className={`panel status-card ${sessionActive ? "armed" : "idle"}`}>
        <div className="live-dot" />
        <div className="status-text">
          <b>{statusTitle}</b>
          <p className="muted">{statusBody}</p>
          {error && <p className="stream-error">{error}</p>}
        </div>
        <span className="ratio-pill">9×16</span>
      </section>

      {!sessionActive && (
        <section className="panel audio-card">
          <div className="card-head">
            <h3>Audio</h3>
            {hasAudio && (
              <span className={`status-chip ${audioSettings.calibrated ? "ok" : "todo"}`}>
                {audioSettings.calibrated ? "Levels ready" : "Set levels"}
              </span>
            )}
          </div>

          <div className="src-grid">
            {SOURCE_OPTIONS.map((opt) => {
              const active = audioSettings.source === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`src-card ${active ? "active" : ""}`}
                  onClick={() =>
                    setAudioSettings({ source: opt.id, calibrated: opt.id === "none" })
                  }
                >
                  <span className="src-radio" aria-hidden />
                  <span className="src-text">
                    <b>{opt.label}</b>
                    <span className="muted">{opt.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <AutoHeight trigger={`${audioSettings.source}:${audioSettings.calibrated}:${micDevices.length}`}>
            {hasAudio && (
            <div className="audio-config">
              {wantsMic && micDevices.length > 0 && (
                <label className="select-field">
                  <span className="select-label">Microphone</span>
                  <select
                    value={audioSettings.microphoneId ?? ""}
                    onChange={(e) =>
                      setAudioSettings({
                        microphoneId: e.target.value || null,
                        calibrated: false,
                      })
                    }
                  >
                    <option value="">Default microphone</option>
                    {micDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="chan-row">
                {wantsSystem && (
                  <Channel
                    name="System"
                    level={audioLevels.system}
                    gain={audioSettings.systemGain}
                    onGain={(systemGain) => setAudioSettings({ systemGain, calibrated: false })}
                  />
                )}
                {wantsMic && (
                  <Channel
                    name="Microphone"
                    level={audioLevels.mic}
                    gain={audioSettings.micGain}
                    onGain={(micGain) => setAudioSettings({ micGain, calibrated: false })}
                  />
                )}
              </div>

              <div className={`calib-bar ${audioSettings.calibrated ? "ok" : ""}`}>
                <div className="calib-text">
                  <b>{audioSettings.calibrated ? "Levels confirmed" : "Set your levels"}</b>
                  <span className="muted">
                    {audioSettings.calibrated
                      ? "You're good to record."
                      : "Play audio or speak, tune the gain, then confirm."}
                  </span>
                </div>
                <button
                  type="button"
                  className={`btn sm ${audioSettings.calibrated ? "blue" : "pink"}`}
                  onClick={() => markAudioCalibrated()}
                >
                  {audioSettings.calibrated ? "✓ Confirmed" : "Confirm levels"}
                </button>
              </div>
            </div>
            )}
          </AutoHeight>
        </section>
      )}

      <div className="studio-actions studio-actions-stack">
        {arming ? (
          <button className="btn stop" onClick={() => cancelRecordingCountdown()}>
            Cancel countdown
          </button>
        ) : recording || finalizing ? (
          <button className="btn stop" disabled={finalizing} onClick={() => stopRecording()}>
            {finalizing ? "Saving…" : "◼ Stop recording"}
          </button>
        ) : (
          <button
            className="btn rec"
            disabled={!canRecord()}
            title={needsCalibration ? "Confirm your audio levels before recording" : undefined}
            onClick={() => startRecording()}
          >
            ● Record
          </button>
        )}
      </div>

      <section className="panel frame-card">
        <div className="frame-legend">
          <span className="frame-keys">
            <span className="kbd">Alt</span>
            <span className="frame-plus">+</span>
            <span className="kbd">scroll</span>
          </span>
          <span className="muted">
            {arming
              ? "Position your shot before the countdown ends."
              : sessionActive
                ? "Frame stays visible while recording."
                : "Zoom in / out — pauses 1s at full 9×16."}
          </span>
        </div>
        {!sessionActive && (
          <button
            className={`btn sm ${overlayVisible ? "ghost" : "blue"}`}
            onClick={() => setOverlayVisible(!overlayVisible)}
          >
            {overlayVisible ? "Hide frame" : "Show frame"}
          </button>
        )}
      </section>
    </div>
  );
}

/**
 * Animates its own height whenever `trigger` changes, so the audio card grows
 * and shrinks with a buttery transition instead of snapping. Measures the
 * inner content after layout and sets an explicit height the CSS can ease to.
 */
function AutoHeight({ children, trigger }: { children: ReactNode; trigger: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    if (inner.current) setHeight(inner.current.scrollHeight);
  }, [trigger]);

  return (
    <div className="auto-h" style={{ height: height === "auto" ? undefined : height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

function Channel({
  name,
  level,
  gain,
  onGain,
}: {
  name: string;
  level: number;
  gain: number;
  onGain: (gain: number) => void;
}) {
  const pct = Math.min(100, Math.round(level * 100));
  return (
    <div className="chan">
      <div className="chan-head">
        <span className="chan-name">{name}</span>
        <span className="chan-pct muted">{pct}%</span>
      </div>
      <div className="meter">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="chan-gain">
        <span className="chan-gain-label muted">Gain</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={gain}
          onChange={(e) => onGain(Number(e.target.value))}
        />
        <span className="chan-gain-val">{gain.toFixed(2)}×</span>
      </div>
    </div>
  );
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
