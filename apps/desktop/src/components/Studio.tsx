import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import type { AudioSourceMode } from "../lib/types";

const SOURCE_OPTIONS: { id: AudioSourceMode; label: string }[] = [
  { id: "none", label: "No audio" },
  { id: "system", label: "System audio" },
  { id: "microphone", label: "Microphone" },
  { id: "system_and_microphone", label: "System + mic" },
];

const RESOLUTIONS = [720, 1080] as const;
const FRAME_RATES = [30, 60] as const;

export function Studio() {
  const {
    recording,
    finalizing,
    arming,
    error,
    audioSettings,
    audioDevices,
    audioLevels,
    setAudioSettings,
    recordingSettings,
    setRecordingSettings,
    inputSettings,
    setInputSettings,
  } = useStore();

  const sessionActive = recording || finalizing || arming;
  const wantsSystem =
    audioSettings.source === "system" || audioSettings.source === "system_and_microphone";
  const wantsMic =
    audioSettings.source === "microphone" || audioSettings.source === "system_and_microphone";
  const micDevices = audioDevices.filter((d) => d.kind === "microphone");
  const hasAudio = audioSettings.source !== "none";

  return (
    <div className="scroll pad">
      <div className="studio">
        {error && <p className="err">{error}</p>}

        {!sessionActive && (
          <>
            <section className="field-card">
              <span className="field-label">Quality</span>
              <div className="toggle toggle--slim" role="group" aria-label="Resolution">
                {RESOLUTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={`toggle-opt ${recordingSettings.quality === q ? "active" : ""}`}
                    aria-pressed={recordingSettings.quality === q}
                    onClick={() => setRecordingSettings({ quality: q })}
                  >
                    {q}p
                  </button>
                ))}
              </div>
              <div className="toggle toggle--slim" role="group" aria-label="Frame rate">
                {FRAME_RATES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`toggle-opt ${recordingSettings.fps === f ? "active" : ""}`}
                    aria-pressed={recordingSettings.fps === f}
                    onClick={() => setRecordingSettings({ fps: f })}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </section>

            <div className="grid2">
              <section className="field-card">
                <span className="field-label">Hide cursor in video</span>
                <div className="toggle" role="group" aria-label="Hide cursor in video">
                  {(["no", "yes"] as const).map((choice) => {
                    const hide = choice === "yes";
                    const active = hide === !recordingSettings.captureCursor;
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`toggle-opt ${active ? "active" : ""}`}
                        aria-pressed={active}
                        onClick={() => setRecordingSettings({ captureCursor: !hide })}
                      >
                        {choice === "no" ? "No" : "Yes"}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="field-card">
                <div className="row">
                  <span className="field-label">Zoom sensitivity</span>
                  <span className="muted">{inputSettings.zoomSensitivity.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={3}
                  step={0.05}
                  value={inputSettings.zoomSensitivity}
                  onChange={(e) => setInputSettings({ zoomSensitivity: parseFloat(e.target.value) })}
                />
              </section>
            </div>

            <section className="audio">
              <span className="field-label">Audio</span>

              <div className="src-grid">
                {SOURCE_OPTIONS.map((opt) => {
                  const active = audioSettings.source === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`src ${active ? "active" : ""}`}
                      onClick={() => setAudioSettings({ source: opt.id })}
                    >
                      <span className="src-radio" aria-hidden />
                      <span className="src-main">
                        <span className="src-name">{opt.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <AutoHeight trigger={`${audioSettings.source}:${micDevices.length}`}>
                {hasAudio && (
                  <div className="audio-config">
                    {wantsMic && micDevices.length > 0 && (
                      <label className="select-field">
                        <span className="label">Microphone</span>
                        <select
                          className="select"
                          value={audioSettings.microphoneId ?? ""}
                          onChange={(e) =>
                            setAudioSettings({ microphoneId: e.target.value || null })
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
                          onGain={(systemGain) => setAudioSettings({ systemGain })}
                        />
                      )}
                      {wantsMic && (
                        <Channel
                          name="Microphone"
                          level={audioLevels.mic}
                          gain={audioSettings.micGain}
                          onGain={(micGain) => setAudioSettings({ micGain })}
                        />
                      )}
                    </div>
                  </div>
                )}
              </AutoHeight>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Animates its own height whenever `trigger` changes, so the audio card grows
 * and shrinks with a buttery transition instead of snapping.
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
        <span className="chan-pct">{pct}%</span>
      </div>
      <div className="meter">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="chan-gain">
        <span className="chan-gain-label">Gain</span>
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
