import { useEffect, useRef, useState } from "react";
import { Reveal } from "./Reveal";
import { useStore } from "../state/store";
import { invoke } from "../lib/bridge";
import { useAuth } from "../lib/auth";
import { qualityLabel } from "../lib/geometry";
import type {
  AudioSourceMode,
  GameWebcamCorner,
  RecordingSettings,
  WebcamDeviceInfo,
} from "../lib/types";
import { LockIcon } from "./icons";

const AUDIO_OPTIONS: { id: AudioSourceMode; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "microphone", label: "Mic" },
  { id: "system", label: "PC" },
  { id: "system_and_microphone", label: "Both" },
];

const PORTRAIT_RESOLUTIONS = [720, 1080] as const;
const LANDSCAPE_RESOLUTIONS = [720, 1080, 1440, 2160] as const;
const FRAME_RATES = [30, 60] as const;

const PROMO_DEMO_RECORDING: RecordingSettings = {
  orientation: "portrait",
  fps: 30,
  quality: 720,
  captureCursor: true,
  cinematicCursor: true,
  mouseClickAudio: false,
  mouseClickVolume: 1,
  promoEnabled: false,
  gameMode: false,
  gamePanMode: "crosshair",
  gameWebcamEnabled: false,
  gameWebcamDeviceId: null,
  gameWebcamPortraitSize: "medium",
  gameWebcamPipCorner: "topright",
  gameWebcamPipSize: "medium",
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

  const [demoSettings, setDemoSettings] = useState<RecordingSettings>(PROMO_DEMO_RECORDING);
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
    ? (patch: Partial<RecordingSettings>) =>
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
  const wantsSystem =
    activeAudioSettings.source === "system" || activeAudioSettings.source === "system_and_microphone";
  const wantsMic =
    activeAudioSettings.source === "microphone" || activeAudioSettings.source === "system_and_microphone";
  const micDevices = audioDevices.filter((d) => d.kind === "microphone");
  const hasAudio = activeAudioSettings.source !== "none";
  const isGameMode = activeRecordingSettings.gameMode;

  function setCaptureMode(game: boolean) {
    if (game === isGameMode) return;
    if (game) {
      patchRecordingSettings({
        gameMode: true,
        captureCursor: false,
        mouseClickAudio: false,
      });
    } else {
      patchRecordingSettings({ gameMode: false });
    }
  }

  const showMicPicker = wantsMic && micDevices.length > 0;

  return (
    <div className="scroll pad">
      <div className={`studio ${promoMock ? "studio--promo-mock" : ""}`}>
        <Reveal show={Boolean(error)}>
          <p className="err">{error}</p>
        </Reveal>
        <Reveal show={promoMock}>
          <p className="card-sub promo-mock-hint">
            Promo preview — controls are for show only while the usage track records.
          </p>
        </Reveal>

        <Reveal show={promoMock || !sessionActive}>
          <div className="studio-stack">
            <section className="field-card record-setup-card">
              <div className="record-setup-row">
                <span className="field-label">Mode</span>
                <div className="toggle capture-mode-toggle" role="group" aria-label="Capture mode">
                  <button
                    type="button"
                    className={`toggle-opt ${!isGameMode ? "active" : ""}`}
                    aria-pressed={!isGameMode}
                    onClick={() => setCaptureMode(false)}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    className={`toggle-opt ${isGameMode ? "active" : ""}`}
                    aria-pressed={isGameMode}
                    onClick={() => setCaptureMode(true)}
                  >
                    Game
                  </button>
                </div>
              </div>

              <div className="record-setup-row">
                <span className="field-label">Format</span>
                <div className="toggle toggle--slim" role="group" aria-label="Recording format">
                  <button
                    type="button"
                    className={`toggle-opt ${activeRecordingSettings.orientation === "portrait" ? "active" : ""}`}
                    aria-pressed={activeRecordingSettings.orientation === "portrait"}
                    onClick={() => patchRecordingSettings({ orientation: "portrait" })}
                  >
                    9×16
                  </button>
                  <button
                    type="button"
                    className={`toggle-opt ${activeRecordingSettings.orientation === "landscape" ? "active" : ""}`}
                    aria-pressed={activeRecordingSettings.orientation === "landscape"}
                    onClick={() => patchRecordingSettings({ orientation: "landscape" })}
                  >
                    16×9
                  </button>
                </div>
              </div>

              <div className="record-setup-row quality-row">
                <span className="field-label">Quality</span>
                <div className="toggle toggle--slim quality-toggle" role="group" aria-label="Resolution">
                  {resolutions.map((q) => {
                    const proLocked = isLandscape && (q === 1440 || q === 2160) && !isPro;
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
                <div className="toggle toggle--slim quality-toggle" role="group" aria-label="Frame rate">
                  {FRAME_RATES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`toggle-opt ${activeRecordingSettings.fps === f ? "active" : ""}`}
                      aria-pressed={activeRecordingSettings.fps === f}
                      onClick={() => patchRecordingSettings({ fps: f })}
                    >
                      {f} fps
                    </button>
                  ))}
                </div>
              </div>

              <div className="record-setup-row">
                <span className="field-label">Audio</span>
                <div className="toggle toggle--slim toggle--audio" role="group" aria-label="Audio source">
                  {AUDIO_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`toggle-opt ${activeAudioSettings.source === opt.id ? "active" : ""}`}
                      aria-pressed={activeAudioSettings.source === opt.id}
                      onClick={() => patchAudioSettings({ source: opt.id })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <Reveal show={showMicPicker}>
                  <label className="select-field compact-select">
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
                </Reveal>
              </div>

              <Reveal show={isGameMode}>
                <div className="record-setup-row">
                  <span className="field-label">Webcam</span>
                  <GameWebcamToggle settings={activeRecordingSettings} patch={patchRecordingSettings} />
                </div>
              </Reveal>

              <Reveal show={isGameMode && !isLandscape}>
                <div className="record-setup-row">
                  <span className="field-label">Frame follows</span>
                  <div className="toggle toggle--slim" role="group" aria-label="Portrait pan mode">
                    {(
                      [
                        { id: "crosshair" as const, label: "Centered" },
                        { id: "cursor" as const, label: "Cursor" },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className={`toggle-opt ${activeRecordingSettings.gamePanMode === id ? "active" : ""}`}
                        aria-pressed={activeRecordingSettings.gamePanMode === id}
                        onClick={() => patchRecordingSettings({ gamePanMode: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Reveal>

              <Reveal show={isGameMode}>
                <div className="record-setup-row">
                  <span className="field-label">Cursor</span>
                  <div className="toggle toggle--slim" role="group" aria-label="Show cursor in video">
                    {(["show", "hide"] as const).map((choice) => {
                      const show = choice === "show";
                      const active = show === activeRecordingSettings.captureCursor;
                      return (
                        <button
                          key={choice}
                          type="button"
                          className={`toggle-opt ${active ? "active" : ""}`}
                          aria-pressed={active}
                          onClick={() => patchRecordingSettings({ captureCursor: show })}
                        >
                          {show ? "Show" : "Hide"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Reveal>
            </section>

            <details className="record-advanced">
              <summary>Fine-tune</summary>
              <div className="record-advanced-body">
                <Reveal show={hasAudio}>
                  <section className="record-advanced-section">
                    <span className="field-label">Audio levels</span>
                    <div className="chan-row">
                      <Reveal show={wantsSystem}>
                        <Channel
                          name="System"
                          level={audioLevels.system}
                          gain={activeAudioSettings.systemGain}
                          onGain={(systemGain) => patchAudioSettings({ systemGain })}
                        />
                      </Reveal>
                      <Reveal show={wantsMic}>
                        <Channel
                          name="Microphone"
                          level={audioLevels.mic}
                          gain={activeAudioSettings.micGain}
                          onGain={(micGain) => patchAudioSettings({ micGain })}
                        />
                      </Reveal>
                    </div>
                  </section>
                </Reveal>

                <Reveal show={isGameMode && activeRecordingSettings.gameWebcamEnabled}>
                  <section className="record-advanced-section">
                    <span className="field-label">Webcam setup</span>
                    <GameWebcamAdvanced
                      settings={activeRecordingSettings}
                      patch={patchRecordingSettings}
                      isLandscape={isLandscape}
                    />
                  </section>
                </Reveal>

                <Reveal show={!isGameMode}>
                  <div className="grid2">
                    <section className="record-advanced-section">
                      <span className="field-label">Hide cursor</span>
                      <div className="toggle toggle--slim" role="group" aria-label="Hide cursor in video">
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
                              {choice === "no" ? "Show" : "Hide"}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section className="record-advanced-section">
                      <span className="field-label">Click sounds</span>
                      <div className="toggle toggle--slim" role="group" aria-label="Mouse click audio">
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
                      <Reveal show={activeRecordingSettings.mouseClickAudio}>
                        <MouseClickVolume
                          volume={activeRecordingSettings.mouseClickVolume}
                          onVolume={(mouseClickVolume) =>
                            patchRecordingSettings({ mouseClickVolume })
                          }
                        />
                      </Reveal>
                    </section>
                  </div>

                  <section className="record-advanced-section">
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
                        onChange={(e) =>
                          patchInputSettings({ followSpeed: parseFloat(e.target.value) })
                        }
                      />
                      <span className="range-notch-mark" aria-hidden title="Default" />
                    </div>
                  </section>

                  <section className="record-advanced-section">
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
                      onChange={(e) =>
                        patchInputSettings({ zoomSensitivity: parseFloat(e.target.value) })
                      }
                    />
                  </section>
                </Reveal>
              </div>
            </details>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function GameWebcamToggle({
  settings,
  patch,
}: {
  settings: RecordingSettings;
  patch: (p: Partial<RecordingSettings>) => void;
}) {
  return (
    <div className="toggle toggle--slim" role="group" aria-label="Webcam">
      {(["off", "on"] as const).map((choice) => {
        const on = choice === "on";
        const active = on === settings.gameWebcamEnabled;
        return (
          <button
            key={choice}
            type="button"
            className={`toggle-opt ${active ? "active" : ""}`}
            aria-pressed={active}
            onClick={() => patch({ gameWebcamEnabled: on })}
          >
            {choice === "off" ? "Off" : "On"}
          </button>
        );
      })}
    </div>
  );
}

function GameWebcamAdvanced({
  settings,
  patch,
  isLandscape,
}: {
  settings: RecordingSettings;
  patch: (p: Partial<RecordingSettings>) => void;
  isLandscape: boolean;
}) {
  const [devices, setDevices] = useState<WebcamDeviceInfo[]>([]);

  useEffect(() => {
    void invoke<WebcamDeviceInfo[]>("list_webcam_devices")
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  return (
    <div className="audio-config" style={{ marginTop: 4 }}>
      {devices.length > 0 ? (
        <label className="select-field compact-select">
          <span className="label">Camera</span>
          <select
            className="select"
            value={settings.gameWebcamDeviceId ?? ""}
            onChange={(e) => patch({ gameWebcamDeviceId: e.target.value || null })}
          >
            <option value="">Default camera</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="card-sub muted">No cameras found — check Windows camera permissions.</p>
      )}

      {isLandscape ? (
        <>
          <span className="field-label" style={{ marginTop: 10, display: "block" }}>
            PiP corner
          </span>
          <div className="webcam-corner-grid" role="group" aria-label="Webcam corner">
            {(
              [
                { id: "topleft" as GameWebcamCorner, label: "Top left" },
                { id: "topright" as GameWebcamCorner, label: "Top right" },
                { id: "bottomleft" as GameWebcamCorner, label: "Bottom left" },
                { id: "bottomright" as GameWebcamCorner, label: "Bottom right" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`webcam-corner-opt ${settings.gameWebcamPipCorner === id ? "active" : ""}`}
                aria-pressed={settings.gameWebcamPipCorner === id}
                title={label}
                aria-label={label}
                onClick={() => patch({ gameWebcamPipCorner: id })}
              >
                <span className="webcam-corner-dot" />
              </button>
            ))}
          </div>
        </>
      ) : null}
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
