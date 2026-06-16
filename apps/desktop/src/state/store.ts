import { create } from "zustand";
import { invoke, listen } from "../lib/bridge";
import { normalizeZoom } from "../lib/geometry";
import type {
  AudioDeviceInfo,
  AudioLevels,
  AudioSettings,
  CaptureState,
  InputSettings,
  MonitorInfo,
  RecordingInfo,
  RecordingSettings,
  Viewport,
} from "../lib/types";

const DEFAULT_AUDIO: AudioSettings = {
  source: "none",
  microphoneId: null,
  systemGain: 1,
  micGain: 1,
  micDelayMs: 0,
  calibrated: true,
};

const DEFAULT_VIEWPORT: Viewport = {
  x: 960,
  y: 540,
  zoom: 1,
  rotation: 0,
  orientation: "portrait",
};

/** Drops stale `set_audio_settings` responses when sliders move quickly. */
let audioSettingsRequest = 0;

interface Store {
  ready: boolean;
  monitors: MonitorInfo[];
  monitor: MonitorInfo | null;
  viewport: Viewport;
  recording: boolean;
  finalizing: boolean;
  saveProgress: number;
  savePhase: string;
  arming: boolean;
  countdownSeconds: number;
  frameFrozen: boolean;
  cameraEnabled: boolean;
  cameraConnected: boolean;
  elapsed: number;
  sizeBytes: number;
  error: string | null;
  recordings: RecordingInfo[];
  inputSettings: InputSettings;
  recordingSettings: RecordingSettings;
  overlayVisible: boolean;
  tab: "studio" | "preview" | "settings";
  audioSettings: AudioSettings;
  audioDevices: AudioDeviceInfo[];
  audioLevels: AudioLevels;

  init: () => Promise<void>;
  setTab: (t: Store["tab"]) => void;
  setViewport: (v: Partial<Viewport>) => Promise<void>;
  setZoom: (z: number) => Promise<void>;
  startRecording: () => Promise<void>;
  cancelRecordingCountdown: () => Promise<void>;
  stopRecording: () => Promise<void>;
  startCamera: () => Promise<void>;
  stopCamera: () => Promise<void>;
  refreshRecordings: () => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
  openFolder: () => Promise<void>;
  setInputSettings: (s: Partial<InputSettings>) => Promise<void>;
  setRecordingSettings: (s: Partial<RecordingSettings>) => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setAudioSettings: (s: Partial<AudioSettings>) => Promise<void>;
  markAudioCalibrated: () => Promise<void>;
  canRecord: () => boolean;
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  monitors: [],
  monitor: null,
  viewport: DEFAULT_VIEWPORT,
  recording: false,
  finalizing: false,
  saveProgress: 0,
  savePhase: "",
  arming: false,
  countdownSeconds: 0,
  frameFrozen: false,
  cameraEnabled: false,
  cameraConnected: false,
  elapsed: 0,
  sizeBytes: 0,
  error: null,
  recordings: [],
  inputSettings: { zoomSensitivity: 1 },
  recordingSettings: {
    orientation: "portrait",
    fps: 30,
    quality: 1080,
    captureCursor: true,
  },
  overlayVisible: false,
  tab: "studio",
  audioSettings: DEFAULT_AUDIO,
  audioDevices: [],
  audioLevels: { system: 0, mic: 0 },

  init: async () => {
    void invoke("notify_app_ready").catch(() => {});

    listen("viewport:update", (p: Viewport) =>
      set({ viewport: { ...p, orientation: "portrait" } })
    );
    listen("recording:tick", (p: { elapsed: number; size_bytes: number }) =>
      set({ elapsed: p.elapsed, sizeBytes: p.size_bytes, error: null })
    );
    listen("recording:countdown", (p: { seconds: number }) =>
      set({
        countdownSeconds: p.seconds,
        arming: p.seconds > 0,
        overlayVisible: p.seconds > 0 ? true : get().overlayVisible,
      })
    );
    listen("recording:state", (p: { recording: boolean; finalizing?: boolean; arming?: boolean }) =>
      set({
        recording: p.recording,
        finalizing: p.finalizing ?? false,
        saveProgress: p.finalizing ? get().saveProgress : 0,
        savePhase: p.finalizing ? get().savePhase : "",
        arming: p.arming ?? (p.recording ? false : get().arming),
        countdownSeconds: p.recording || p.arming === false ? 0 : get().countdownSeconds,
        overlayVisible: p.recording || p.arming ? true : p.finalizing ? false : get().overlayVisible,
        frameFrozen: p.recording || p.arming ? get().frameFrozen : false,
      })
    );
    listen("recording:save-progress", (p: { percent: number; phase: string }) =>
      set((state) => {
        const next = Math.max(state.saveProgress, p.percent);
        return {
          saveProgress: next,
          savePhase: p.percent >= state.saveProgress ? p.phase : state.savePhase,
        };
      })
    );
    listen("camera:tick", (p: { connected: boolean }) =>
      set({ cameraConnected: p.connected })
    );
    listen("camera:state", (p: { enabled: boolean }) =>
      set({ cameraEnabled: p.enabled, cameraConnected: false, error: null })
    );
    listen("app:log", (msg: string) => set({ error: msg }));
    listen("audio:levels", (p: AudioLevels) => set({ audioLevels: p }));
    listen("audio:settings", (p: AudioSettings) => set({ audioSettings: p }));

    listen("hotkey:toggle-recording", () => {
      const s = get();
      if (s.finalizing) return;
      if (s.recording) void s.stopRecording();
      else if (s.arming) void s.cancelRecordingCountdown();
      else void s.startRecording().catch(() => {});
    });
    listen("hotkey:toggle-overlay", () => {
      const s = get();
      if (s.recording || s.arming || s.finalizing) return;
      void s.setOverlayVisible(!s.overlayVisible);
    });
    listen("frame:freeze", (p: { frozen: boolean }) => set({ frameFrozen: p.frozen }));

    set({ ready: true });

    const [monitors, state, audioSettings] = await Promise.all([
      invoke<MonitorInfo[]>("list_monitors"),
      invoke<CaptureState>("get_state"),
      invoke<AudioSettings>("get_audio_settings"),
    ]);

    set({
      monitors,
      monitor: state.monitor ?? monitors[0] ?? null,
      viewport: { ...state.viewport, orientation: "portrait" },
      recording: state.recording,
      arming: state.recordingArmed ?? false,
      countdownSeconds: state.countdownSeconds ?? 0,
      frameFrozen: state.frameFrozen ?? false,
      cameraEnabled: state.cameraEnabled ?? false,
      cameraConnected: state.cameraConnected ?? false,
      elapsed: state.elapsed,
      overlayVisible: state.overlayVisible ?? false,
      audioSettings,
    });

    void invoke<AudioDeviceInfo[]>("list_audio_devices")
      .then((audioDevices) => set({ audioDevices }))
      .catch(() => {});

    if (audioSettings.source !== "none") {
      await invoke("start_audio_monitor").catch(() => {});
    }

    void get().refreshRecordings();
  },

  setTab: (tab) => set({ tab }),

  setViewport: async (v) => {
    const next = { ...get().viewport, ...v };
    set({ viewport: next });
    await invoke("set_viewport", { viewport: next });
  },

  setZoom: async (z) => {
    const zoom = normalizeZoom(z);
    set({ viewport: { ...get().viewport, zoom } });
    await invoke("set_zoom", { zoom });
  },

  startRecording: async () => {
    if (!get().canRecord()) {
      const err = "Calibrate audio in Studio before recording.";
      set({ error: err });
      throw new Error(err);
    }
    set({
      error: null,
      elapsed: 0,
      sizeBytes: 0,
      arming: true,
      countdownSeconds: 5,
      overlayVisible: true,
    });
    try {
      const { recordingSettings } = get();
      const state = await invoke<CaptureState>("start_recording", { settings: recordingSettings });
      set({
        arming: state.recordingArmed,
        countdownSeconds: state.countdownSeconds,
        overlayVisible: true,
      });
    } catch (e) {
      set({ error: String(e), arming: false, countdownSeconds: 0 });
      throw e;
    }
  },

  cancelRecordingCountdown: async () => {
    set({ error: null });
    try {
      const state = await invoke<CaptureState>("cancel_recording_countdown");
      set({
        arming: false,
        countdownSeconds: 0,
        overlayVisible: state.overlayVisible,
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  stopRecording: async () => {
    if (get().finalizing) return;
    set({ error: null, recording: false, finalizing: true, saveProgress: 0, savePhase: "starting" });
    try {
      const rec = await new Promise<RecordingInfo | null>((resolve, reject) => {
        listen("recording:finished", (payload: RecordingInfo | null) => {
          resolve(payload);
        })
          .then(async (unlisten) => {
            try {
              await invoke("stop_recording");
            } catch (e) {
              unlisten();
              reject(e);
            }
          })
          .catch(reject);
      });
      set((s) => ({
        finalizing: false,
        saveProgress: 0,
        savePhase: "",
        arming: false,
        countdownSeconds: 0,
        recordings: rec ? [rec, ...s.recordings] : s.recordings,
      }));
      const state = await invoke<CaptureState>("get_state");
      set({ overlayVisible: state.overlayVisible });
      if (get().audioSettings.source !== "none") {
        await invoke("start_audio_monitor").catch(() => {});
      }
      if (rec) {
        await get().refreshRecordings();
      }
    } catch (e) {
      set({ recording: false, finalizing: false, error: String(e) });
      throw e;
    }
  },

  startCamera: async () => {
    set({ error: null });
    try {
      const state = await invoke<CaptureState>("start_camera");
      set({
        cameraEnabled: state.cameraEnabled,
        cameraConnected: state.cameraConnected,
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  stopCamera: async () => {
    set({ error: null });
    try {
      const state = await invoke<CaptureState>("stop_camera");
      set({
        cameraEnabled: state.cameraEnabled,
        cameraConnected: state.cameraConnected,
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refreshRecordings: async () => {
    const recordings = await invoke<RecordingInfo[]>("list_recordings");
    set({ recordings });
  },

  deleteRecording: async (id) => {
    await invoke("delete_recording", { id });
    set((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }));
  },

  openFolder: async () => {
    await invoke("open_recordings_folder");
  },

  setInputSettings: async (s) => {
    const next = { ...get().inputSettings, ...s };
    set({ inputSettings: next });
    await invoke("set_input_settings", { settings: next });
  },

  setRecordingSettings: async (s) => {
    const merged = { ...get().recordingSettings, ...s, orientation: "portrait" as const };
    const quality: 720 | 1080 = merged.quality <= 720 ? 720 : 1080;
    const next = { ...merged, quality };
    set({ recordingSettings: next });
    await invoke("set_recording_settings", { settings: next });
  },

  setOverlayVisible: async (visible) => {
    try {
      const state = await invoke<CaptureState>("set_overlay_visible", { visible });
      set({ overlayVisible: state.overlayVisible });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setAudioSettings: async (partial) => {
    const req = ++audioSettingsRequest;
    const next = { ...get().audioSettings, ...partial };
    set({ audioSettings: next });
    try {
      const saved = await invoke<AudioSettings>("set_audio_settings", { settings: next });
      if (req === audioSettingsRequest) {
        set({ audioSettings: saved });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  markAudioCalibrated: async () => {
    await get().setAudioSettings({ calibrated: true });
  },

  canRecord: () => {
    const { audioSettings } = get();
    if (audioSettings.source === "none") return true;
    return audioSettings.calibrated;
  },
}));
