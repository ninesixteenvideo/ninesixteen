export type Orientation = "landscape" | "portrait";

export interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  is_primary: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  orientation: Orientation;
}

export interface StreamSettings {
  serverUrl: string;
  streamKey: string;
  bitrateKbps: number;
}

export interface StreamStats {
  bytesSent: number;
  framesSent: number;
  connected: boolean;
  error: string | null;
}

export interface OverlayFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
}

export interface CaptureState {
  monitor: MonitorInfo | null;
  viewport: Viewport;
  recording: boolean;
  streaming: boolean;
  elapsed: number;
  streamElapsed: number;
  outputWidth: number;
  outputHeight: number;
  streamStats: StreamStats;
  overlayVisible: boolean;
  cameraEnabled: boolean;
  cameraConnected: boolean;
  recordingArmed: boolean;
  countdownSeconds: number;
  overlayFrame?: OverlayFrame | null;
}

export interface RecordingInfo {
  id: string;
  path: string;
  filename: string;
  created_at: number;
  duration: number;
  size_bytes: number;
  width: number;
  height: number;
  orientation: Orientation;
}

export interface InputSettings {
  zoomSensitivity: number;
}

export interface RecordingSettings {
  orientation: Orientation;
  fps: number;
  quality: 720 | 1080;
  captureCursor: boolean;
}

export type AudioSourceMode = "none" | "system" | "microphone" | "system_and_microphone";

export interface AudioSettings {
  source: AudioSourceMode;
  microphoneId: string | null;
  systemGain: number;
  micGain: number;
  micDelayMs: number;
  calibrated: boolean;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  kind: "system" | "microphone" | string;
}

export interface AudioLevels {
  system: number;
  mic: number;
}