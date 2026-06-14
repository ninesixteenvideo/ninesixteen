import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { useRecordingElapsed } from "../lib/useRecordingElapsed";
import type { AudioSourceMode } from "../lib/types";

const SOURCE_OPTIONS: { id: AudioSourceMode; label: string; hint: string }[] = [
  { id: "none", label: "No audio", hint: "Video only" },
  { id: "system", label: "System audio", hint: "Games, browser & apps" },
  { id: "microphone", label: "Microphone", hint: "Your voice or external mic" },
  { id: "system_and_microphone", label: "System + mic", hint: "Desktop audio and voice" },
];

const SAVE_PHASE_LABELS: Record<string, string> = {
  starting: "Preparing",
  finalizing: "Finishing video",
  timing: "Syncing timing",
  audio: "Adding audio",
  encrypting: "Encrypting",
};

const QUALITY_PRESETS = [
  { quality: 1080 as const, fps: 30, label: "1080p · 30fps (Recommended)" },
  { quality: 1080 as const, fps: 60, label: "1080p · 60fps" },
  { quality: 720 as const, fps: 30, label: "720p · 30fps" },
  { quality: 720 as const, fps: 60, label: "720p · 60fps" },
];

function qualityPresetValue(quality: number, fps: number) {
  return `${quality}-${fps}`;
}

export function Studio() {
  const {
    recording,
    finalizing,
    saveProgress,
    savePhase,
    arming,
    countdownSeconds,
    elapsed,
    error,
    startRecording,
    cancelRecordingCountdown,
    stopRecording,
    audioSettings,
    audioDevices,
    audioLevels,
    setAudioSettings,
    markAudioCalibrated,
    canRecord,
    recordingSettings,
    setRecordingSettings,
  } = useStore();

  const sessionActive = recording || finalizing || arming;
  const wantsSystem =
    audioSettings.source === "system" || audioSettings.source === "system_and_microphone";
  const wantsMic =
    audioSettings.source === "microphone" || audioSettings.source === "system_and_microphone";
  const micDevices = audioDevices.filter((d) => d.kind === "microphone");
  const hasAudio = audioSettings.source !== "none";
  const needsCalibration = hasAudio && !audioSettings.calibrated;

  const displayElapsed = useRecordingElapsed(recording, elapsed);

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
      ? "Writing and securing your file — this can take a minute on long clips."
      : recording
        ? `Recording ${formatDuration(displayElapsed)}`
        : "Press Record — you'll get 5 seconds to frame your shot first.";

  return (
    <div className="content scroll studio-panel">
      <section className={`panel status-card ${sessionActive ? "armed" : "idle"}`}>
        <div className="live-dot" />
        <div className="status-text">
          <b>{statusTitle}</b>
          <p className="muted">{statusBody}</p>
          {finalizing && (
            <div className="save-progress" role="progressbar" aria-valuenow={saveProgress} aria-valuemin={0} aria-valuemax={100}>
              <div className="save-progress-track">
                <div className="save-progress-fill" style={{ width: `${saveProgress}%` }} />
              </div>
              <span className="save-progress-label">
                {saveProgress}% · {SAVE_PHASE_LABELS[savePhase] ?? "Saving"}
              </span>
            </div>
          )}
          {error && <p className="stream-error">{error}</p>}
        </div>
        <span className="ratio-pill">9×16</span>
      </section>

      {!sessionActive && (
        <section className="panel quality-row">
          <span className="label">Quality</span>
          <select
            className="quality-select"
            value={qualityPresetValue(recordingSettings.quality, recordingSettings.fps)}
            onChange={(e) => {
              const preset = QUALITY_PRESETS.find(
                (p) => qualityPresetValue(p.quality, p.fps) === e.target.value
              );
              if (preset) {
                setRecordingSettings({ quality: preset.quality, fps: preset.fps });
              }
            }}
          >
            {QUALITY_PRESETS.map((preset) => (
              <option
                key={qualityPresetValue(preset.quality, preset.fps)}
                value={qualityPresetValue(preset.quality, preset.fps)}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </section>
      )}

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
  const [draft, setDraft] = useState(gain);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setDraft(gain);
  }, [gain]);

  const pct = Math.min(100, Math.round(level * 100));

  const commit = (value: number) => {
    const clamped = Math.min(2, Math.max(0, value));
    setDraft(clamped);
    onGain(clamped);
  };

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
          value={draft}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            commit(Number(e.currentTarget.value));
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setDraft(gain);
          }}
          onChange={(e) => setDraft(Number(e.target.value))}
          onBlur={(e) => {
            if (dragging.current) return;
            commit(Number(e.currentTarget.value));
          }}
        />
        <span className="chan-gain-val">{draft.toFixed(2)}×</span>
      </div>
    </div>
  );
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
