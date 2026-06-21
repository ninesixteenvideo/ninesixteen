import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { invoke } from "../lib/bridge";
import { useAuth } from "../lib/auth";
import { outputDims, qualityLabel } from "../lib/geometry";
import type { AudioSourceMode, Orientation } from "../lib/types";
import { LockIcon } from "./icons";

const SOURCE_OPTIONS: { id: AudioSourceMode; label: string }[] = [
  { id: "none", label: "No audio" },
  { id: "system", label: "System audio" },
  { id: "microphone", label: "Microphone" },
  { id: "system_and_microphone", label: "System + mic" },
];

const PORTRAIT_RESOLUTIONS = [720, 1080] as const;
const LANDSCAPE_RESOLUTIONS = [720, 1080, 1440, 2160] as const;
const FRAME_RATES = [30, 60] as const;
const FORMATS: { id: Orientation; label: string }[] = [
  { id: "portrait", label: "9×16" },
  { id: "landscape", label: "16×9" },
];

const PROMO_RECORDING_ENABLED =
  import.meta.env.VITE_ENABLE_PROMO_RECORDING === "true";

const PROMO_DEMO_RECORDING = {
  orientation: "portrait" as Orientation,
  fps: 30,
  quality: 720,
  captureCursor: true,
  cinematicCursor: true,
  mouseClickAudio: false,
  mouseClickVolume: 1,
  promoEnabled: false,
};

const PROMO_DEMO_AUDIO = {
  source: "none" as AudioSourceMode,
  microphoneId: null as string | null,
  systemGain: 1,
  micGain: 1,
  micDelayMs: 0,
  calibrated: true,
};

const PROMO_DEMO_INPUT = { zoomSensitivity: 1, followSpeed: 1 };

function followSpeedCaption(v: number): string {
  if (v < 0.88) return "Slower";
  if (v > 1.12) return "Faster";
  return "Default";
}

export function Studio() {
  const {
    recording,
    finalizing,
    arming,
    error,
    promoMode,
    audioSettings,
    audioDevices,
    audioLevels,
    setAudioSettings,
    recordingSettings,
    setRecordingSettings,
    inputSettings,
    setInputSettings,
  } = useStore();
  const { isPro } = useAuth();
  const setPaywallOpen = useStore((s) => s.setPaywallOpen);

  const promoMock = Boolean(promoMode) && !finalizing;
  const sessionActive = finalizing || ((recording || arming) && !promoMock);

  const [demoSettings, setDemoSettings] = useState(PROMO_DEMO_RECORDING);
  const [demoAudio, setDemoAudio] = useState(PROMO_DEMO_AUDIO);
  const [demoInput, setDemoInput] = useState(PROMO_DEMO_INPUT);

  useEffect(() => {
    if (!promoMode) return;
    setDemoSettings(PROMO_DEMO_RECORDING);
    setDemoAudio(PROMO_DEMO_AUDIO);
    setDemoInput(PROMO_DEMO_INPUT);
  }, [promoMode]);

  const activeRecordingSettings = promoMock ? demoSettings : recordingSettings;
  const patchRecordingSettings = promoMock
    ? (patch: Partial<typeof recordingSettings>) =>
        setDemoSettings((s) => ({ ...s, ...patch }))
    : setRecordingSettings;
  const activeAudioSettings = promoMock ? demoAudio : audioSettings;
  const patchAudioSettings = promoMock
    ? (patch: Partial<typeof audioSettings>) => setDemoAudio((s) => ({ ...s, ...patch }))
    : setAudioSettings;
  const activeInputSettings = promoMock ? demoInput : inputSettings;
  const patchInputSettings = promoMock
    ? (patch: Partial<typeof inputSettings>) => setDemoInput((s) => ({ ...s, ...patch }))
    : setInputSettings;

  const isLandscape = activeRecordingSettings.orientation === "landscape";
  const resolutions = isLandscape ? LANDSCAPE_RESOLUTIONS : PORTRAIT_RESOLUTIONS;
  const outputSize = outputDims(activeRecordingSettings.orientation, activeRecordingSettings.quality);
  const wantsSystem =
    activeAudioSettings.source === "system" || activeAudioSettings.source === "system_and_microphone";
  const wantsMic =
    activeAudioSettings.source === "microphone" || activeAudioSettings.source === "system_and_microphone";
  const micDevices = audioDevices.filter((d) => d.kind === "microphone");
  const hasAudio = activeAudioSettings.source !== "none";

  return (
    <div className="scroll pad">
      <div className={`studio ${promoMock ? "studio--promo-mock" : ""}`}>
        {error && <p className="err">{error}</p>}
        {promoMock && (
          <p className="card-sub promo-mock-hint">
            Promo preview — controls are for show only while the usage track records.
          </p>
        )}

        {(promoMock || !sessionActive) && (
          <>
            <section className="field-card">
              <span className="field-label">Format</span>
              <div className="toggle toggle--slim" role="group" aria-label="Recording format">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`toggle-opt ${activeRecordingSettings.orientation === f.id ? "active" : ""}`}
                    aria-pressed={activeRecordingSettings.orientation === f.id}
                    onClick={() => patchRecordingSettings({ orientation: f.id })}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="field-card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="field-label">Quality</span>
                <span className="muted quality-dims">
                  {outputSize.w}×{outputSize.h}
                </span>
              </div>
              <div className="toggle toggle--slim" role="group" aria-label="Resolution">
                {resolutions.map((q) => {
                  const proLocked = (q === 1440 || q === 2160) && !isPro;
                  const label = qualityLabel(q);
                  return (
                    <button
                      key={q}
                      type="button"
                      className={`toggle-opt ${activeRecordingSettings.quality === q ? "active" : ""} ${proLocked ? "toggle-opt--pro" : ""}`}
                      aria-pressed={activeRecordingSettings.quality === q}
                      title={proLocked ? `Pro — ${label} landscape` : undefined}
                      onClick={() => {
                        if (proLocked) {
                          setPaywallOpen(true);
                          return;
                        }
                        patchRecordingSettings({ quality: q });
                      }}
                    >
                      {label}
                      {proLocked ? <LockIcon size={11} /> : null}
                    </button>
                  );
                })}
              </div>
              <div className="toggle toggle--slim" role="group" aria-label="Frame rate">
                {FRAME_RATES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`toggle-opt ${activeRecordingSettings.fps === f ? "active" : ""}`}
                    aria-pressed={activeRecordingSettings.fps === f}
                    onClick={() => patchRecordingSettings({ fps: f })}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </section>

            <section className="audio">
              <span className="field-label">Audio</span>

              <div className="src-grid">
                {SOURCE_OPTIONS.map((opt) => {
                  const active = activeAudioSettings.source === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`src ${active ? "active" : ""}`}
                      onClick={() => patchAudioSettings({ source: opt.id })}
                    >
                      <span className="src-radio" aria-hidden />
                      <span className="src-main">
                        <span className="src-name">{opt.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <AutoHeight trigger={`${activeAudioSettings.source}:${micDevices.length}`}>
                {hasAudio && (
                  <div className="audio-config">
                    {wantsMic && micDevices.length > 0 && (
                      <label className="select-field">
                        <span className="label">Microphone</span>
                        <select
                          className="select"
                          value={activeAudioSettings.microphoneId ?? ""}
                          onChange={(e) =>
                            patchAudioSettings({ microphoneId: e.target.value || null })
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
                          gain={activeAudioSettings.systemGain}
                          onGain={(systemGain) => patchAudioSettings({ systemGain })}
                        />
                      )}
                      {wantsMic && (
                        <Channel
                          name="Microphone"
                          level={audioLevels.mic}
                          gain={activeAudioSettings.micGain}
                          onGain={(micGain) => patchAudioSettings({ micGain })}
                        />
                      )}
                    </div>
                  </div>
                )}
              </AutoHeight>
            </section>

            <div className="grid2">
              <section className="field-card">
                <span className="field-label">Hide cursor in video</span>
                <div className="toggle" role="group" aria-label="Hide cursor in video">
                  {(["no", "yes"] as const).map((choice) => {
                    const hide = choice === "yes";
                    const active = hide === !activeRecordingSettings.captureCursor;
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`toggle-opt ${active ? "active" : ""}`}
                        aria-pressed={active}
                        onClick={() => patchRecordingSettings({ captureCursor: !hide })}
                      >
                        {choice === "no" ? "No" : "Yes"}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="field-card">
                <span className="field-label">Mouse click audio</span>
                <div className="toggle" role="group" aria-label="Mouse click audio">
                  {(["off", "on"] as const).map((choice) => {
                    const on = choice === "on";
                    const active = on === activeRecordingSettings.mouseClickAudio;
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`toggle-opt ${active ? "active" : ""}`}
                        aria-pressed={active}
                        onClick={() => patchRecordingSettings({ mouseClickAudio: on })}
                      >
                        {choice === "off" ? "Off" : "On"}
                      </button>
                    );
                  })}
                </div>
                <MouseClickVolume
                  volume={activeRecordingSettings.mouseClickVolume}
                  onVolume={(mouseClickVolume) => patchRecordingSettings({ mouseClickVolume })}
                />
              </section>
            </div>

            <section className="field-card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="field-label">Follow speed</span>
                <span className="muted">{followSpeedCaption(activeInputSettings.followSpeed)}</span>
              </div>
              <div className="range-notch">
                <input
                  type="range"
                  min={0.75}
                  max={1.25}
                  step={0.05}
                  value={activeInputSettings.followSpeed}
                  aria-label="Follow speed"
                  onChange={(e) => patchInputSettings({ followSpeed: parseFloat(e.target.value) })}
                />
                <span className="range-notch-mark" aria-hidden title="Default" />
              </div>
            </section>

            <section className="field-card">
              <div className="row">
                <span className="field-label">Zoom sensitivity</span>
                <span className="muted">{activeInputSettings.zoomSensitivity.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={activeInputSettings.zoomSensitivity}
                onChange={(e) => patchInputSettings({ zoomSensitivity: parseFloat(e.target.value) })}
              />
            </section>

            {PROMO_RECORDING_ENABLED ? (
              <section className="field-card">
                <span className="field-label">Promo recording</span>
                <p className="card-sub" style={{ marginTop: 6, marginBottom: 10 }}>
                  Alt+P portrait · Alt+L landscape — records you using the app, then your take
                  with a dark transition. 720p60. For marketing only.
                </p>
                <div className="toggle" role="group" aria-label="Promo recording">
                  {(["off", "on"] as const).map((choice) => {
                    const on = choice === "on";
                    const active = on === Boolean(recordingSettings.promoEnabled);
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`toggle-opt ${active ? "active" : ""}`}
                        aria-pressed={active}
                        disabled={promoMock}
                        onClick={() => setRecordingSettings({ promoEnabled: on })}
                      >
                        {choice === "off" ? "Off" : "On"}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
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

function MouseClickVolume({
  volume,
  onVolume,
}: {
  volume: number;
  onVolume: (volume: number) => void;
}) {
  const [draft, setDraft] = useState(volume);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setDraft(volume);
  }, [volume]);

  const commit = (value: number) => {
    const clamped = Math.min(2, Math.max(0, value));
    setDraft(clamped);
    onVolume(clamped);
    void invoke("preview_mouse_click_audio", { volume: clamped }).catch(() => {});
  };

  return (
    <div className="chan-gain" style={{ marginTop: 10 }}>
      <span className="chan-gain-label">Volume</span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={draft}
        aria-label="Mouse click volume"
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          commit(Number(e.currentTarget.value));
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setDraft(volume);
        }}
        onChange={(e) => setDraft(Number(e.target.value))}
        onBlur={(e) => {
          if (dragging.current) return;
          commit(Number(e.currentTarget.value));
        }}
      />
      <span className="chan-gain-val">{draft.toFixed(2)}×</span>
    </div>
  );
}
