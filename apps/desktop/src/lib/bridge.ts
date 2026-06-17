import { normalizeZoom } from "./geometry";
import type {
  AudioDeviceInfo,
  AudioLevels,
  AudioSettings,
  CaptureState,
  MonitorInfo,
  Orientation,
  RecordingInfo,
  Viewport,
} from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (event: string, cb: (payload: any) => void) => Promise<() => void>;

let realInvoke: Invoke | null = null;
let realListen: Listen | null = null;

async function ensureReal() {
  if (!realInvoke) {
    const core = await import("@tauri-apps/api/core");
    const ev = await import("@tauri-apps/api/event");
    realInvoke = core.invoke as Invoke;
    realListen = (event, cb) => ev.listen(event, (e) => cb(e.payload)) as Promise<() => void>;
  }
}

/**
 * Build a URL the webview can load in a <video> tag for a recording id. Streams
 * the decrypted recording through the custom `nsmedia` protocol (recordings are
 * encrypted at rest). In browser dev it just returns the id (no real files).
 */
export async function mediaSrc(id: string): Promise<string> {
  if (!inTauri) return id;
  const core = await import("@tauri-apps/api/core");
  return core.convertFileSrc(id, "nsmedia");
}

const mock = (() => {
  const monitor: MonitorInfo = {
    id: 0,
    name: "Mock Display (browser)",
    width: 1920,
    height: 1080,
    is_primary: true,
  };
  const viewport: Viewport = {
    x: monitor.width / 2,
    y: monitor.height / 2,
    zoom: 1,
    rotation: 0,
    orientation: "portrait",
  };
  let recording = false;
  let arming = false;
  let countdownSeconds = 0;
  let cameraEnabled = false;
  let cameraConnected = false;
  let overlayVisible = false;
  let elapsed = 0;
  let startedAt = 0;
  const recordings: RecordingInfo[] = [];
  const listeners: Record<string, Array<(p: any) => void>> = {};
  let audioSettings: AudioSettings = {
    source: "none",
    microphoneId: null,
    systemGain: 1,
    micGain: 1,
    micDelayMs: 0,
    calibrated: true,
  };
  const audioDevices: AudioDeviceInfo[] = [
    { id: "system:mock", name: "System audio (Mock Speakers)", kind: "system" },
    { id: "mic:mock", name: "Mock Microphone", kind: "microphone" },
  ];
  let audioLevels: AudioLevels = { system: 0, mic: 0 };
  let audioMonitor: ReturnType<typeof setInterval> | null = null;

  function emit(event: string, payload: any) {
    (listeners[event] || []).forEach((cb) => cb(payload));
  }

  function outDims(o: Orientation) {
    return o === "landscape"
      ? { outputWidth: 1920, outputHeight: 1080 }
      : { outputWidth: 1080, outputHeight: 1920 };
  }

  function state(): CaptureState {
    return {
      monitor,
      viewport: { ...viewport },
      recording,
      streaming: false,
      elapsed,
      streamElapsed: 0,
      ...outDims(viewport.orientation),
      streamStats: {
        bytesSent: 0,
        framesSent: 0,
        connected: false,
        error: null,
      },
      overlayVisible: recording || arming ? true : overlayVisible,
      cameraEnabled,
      cameraConnected,
      recordingArmed: arming,
      countdownSeconds,
      captureCursor: true,
      frameFrozen: false,
    };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", (e) => {
      viewport.x = (e.clientX / window.innerWidth) * monitor.width;
      viewport.y = (e.clientY / window.innerHeight) * monitor.height;
      emit("viewport:update", { ...viewport });
    });
    window.addEventListener(
      "wheel",
      (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        const delta = e.deltaY / 120;
        const factor = 1.0 + delta * 0.12;
        viewport.zoom = normalizeZoom(viewport.zoom * factor, viewport.orientation);
        viewport.x = (e.clientX / window.innerWidth) * monitor.width;
        viewport.y = (e.clientY / window.innerHeight) * monitor.height;
        emit("viewport:update", { ...viewport });
      },
      { passive: false }
    );
    setInterval(() => {
      if (recording) {
        elapsed = (Date.now() - startedAt) / 1000;
        emit("recording:tick", { elapsed, size_bytes: Math.floor(elapsed * 850000) });
      }
      if (cameraEnabled) {
        cameraConnected = true;
        emit("camera:tick", { connected: cameraConnected });
      }
    }, 250);
  }

  return {
    state,
    emit,
    async invoke<T>(cmd: string, args: any): Promise<T> {
      switch (cmd) {
        case "list_monitors":
          return [monitor] as unknown as T;
        case "get_state":
          return state() as unknown as T;
        case "get_monitor_thumbnail":
          return "" as unknown as T;
        case "set_viewport": {
          Object.assign(viewport, args.viewport as Viewport);
          emit("viewport:update", { ...viewport });
          return state() as unknown as T;
        }
        case "nudge_viewport": {
          viewport.x += args.dx ?? 0;
          viewport.y += args.dy ?? 0;
          emit("viewport:update", { ...viewport });
          return state() as unknown as T;
        }
        case "set_zoom": {
          viewport.zoom = normalizeZoom(args.zoom as number, viewport.orientation);
          emit("viewport:update", { ...viewport });
          return state() as unknown as T;
        }
        case "start_recording": {
          arming = true;
          countdownSeconds = 5;
          emit("recording:state", { recording: false, arming: true });
          emit("recording:countdown", { seconds: 5 });
          let n = 5;
          const tick = () => {
            if (!arming) return;
            emit("recording:countdown", { seconds: n });
            countdownSeconds = n;
            if (n <= 0) {
              arming = false;
              recording = true;
              startedAt = Date.now();
              elapsed = 0;
              emit("recording:countdown", { seconds: 0 });
              emit("recording:state", { recording: true, arming: false });
              return;
            }
            n -= 1;
            setTimeout(tick, 1000);
          };
          setTimeout(tick, 1000);
          return state() as unknown as T;
        }
        case "cancel_recording_countdown": {
          arming = false;
          countdownSeconds = 0;
          emit("recording:countdown", { seconds: 0 });
          emit("recording:state", { recording: false, arming: false });
          return state() as unknown as T;
        }
        case "stop_recording": {
          recording = false;
          emit("recording:state", { recording: false });
          const d = outDims(viewport.orientation);
          const rec: RecordingInfo = {
            id: crypto.randomUUID(),
            path: "C:/Users/you/Videos/ninesixteen/clip.mp4",
            filename: `ns_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`,
            created_at: Date.now(),
            duration: elapsed,
            size_bytes: Math.floor(elapsed * 850000),
            width: d.outputWidth,
            height: d.outputHeight,
            orientation: viewport.orientation,
          };
          recordings.unshift(rec);
          return rec as unknown as T;
        }
        case "start_camera": {
          cameraEnabled = true;
          cameraConnected = false;
          emit("camera:state", { enabled: true });
          return state() as unknown as T;
        }
        case "stop_camera": {
          cameraEnabled = false;
          cameraConnected = false;
          emit("camera:state", { enabled: false });
          return state() as unknown as T;
        }
        case "list_recordings":
          return recordings as unknown as T;
        case "delete_recording": {
          const i = recordings.findIndex((r) => r.id === args.id);
          if (i >= 0) recordings.splice(i, 1);
          return null as unknown as T;
        }
        case "rename_recording": {
          const i = recordings.findIndex((r) => r.id === args.id);
          if (i >= 0) {
            const raw = String(args.filename ?? "");
            const base = raw.replace(/\.(mp4|ns)$/i, "").trim() || recordings[i].filename;
            recordings[i] = { ...recordings[i], filename: `${base}.mp4` };
            return recordings[i] as unknown as T;
          }
          throw new Error("Recording not found");
        }
        case "export_recording":
          return null as unknown as T;
        case "list_audio_devices":
          return audioDevices as unknown as T;
        case "get_audio_settings":
          return audioSettings as unknown as T;
        case "set_audio_settings": {
          audioSettings = { ...(args.settings as AudioSettings) };
          if (audioSettings.source === "none") {
            audioSettings.calibrated = true;
            if (audioMonitor) {
              clearInterval(audioMonitor);
              audioMonitor = null;
            }
          } else if (!audioMonitor) {
            audioMonitor = setInterval(() => {
              audioLevels = {
                system:
                  audioSettings.source === "system" ||
                  audioSettings.source === "system_and_microphone"
                    ? 0.15 + Math.random() * 0.35
                    : 0,
                mic:
                  audioSettings.source === "microphone" ||
                  audioSettings.source === "system_and_microphone"
                    ? 0.1 + Math.random() * 0.3
                    : 0,
              };
              emit("audio:levels", audioLevels);
            }, 100);
          }
          emit("audio:settings", audioSettings);
          return audioSettings as unknown as T;
        }
        case "start_audio_monitor":
        case "stop_audio_monitor":
        case "get_audio_levels":
          return null as unknown as T;
        case "show_overlay":
        case "hide_overlay":
        case "open_recordings_folder":
        case "set_input_settings":
        case "set_recording_settings":
        case "set_overlay_visible": {
          if (cmd === "set_overlay_visible") {
            overlayVisible = args.visible as boolean;
          }
          return state() as unknown as T;
        }
        default:
          return null as unknown as T;
      }
    },
    async listen(event: string, cb: (p: any) => void) {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    },
  };
})();

export const isDesktop = inTauri;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri) {
    await ensureReal();
    return realInvoke!<T>(cmd, args);
  }
  return mock.invoke<T>(cmd, args ?? {});
}

export async function listen(event: string, cb: (payload: any) => void): Promise<() => void> {
  if (inTauri) {
    await ensureReal();
    return realListen!(event, cb);
  }
  return mock.listen(event, cb);
}