export type Release = {
  version: string;
  date: string;
  items: readonly string[];
  /** Preview of a future desktop build — not available to download yet. */
  upcoming?: boolean;
};

export const RELEASES: readonly Release[] = [
  {
    version: "1.2.0",
    date: "June 2026",
    items: [
      "Game mode — locks full 9×16 or 16×9 with no zoom; portrait Crosshair (centered) or Cursor (horizontal pan); system cursor in output",
      "4K landscape (3840×2160) @ 60 fps — Pro export",
      "1440p landscape @ 60 fps — Pro export",
      "Hardware-aware quality caps in Studio — recommends resolution and fps your PC can encode reliably",
      "Adaptive H.264 pipeline — NVENC, AMD AMF, Intel QSV, or software fallback, probed at your recording size",
      "Tier limits from RAM, CPU threads, and GPU VRAM — stronger rigs unlock higher ceilings automatically",
      "Portrait capped at 1080p — landscape runs 720p through 4K",
    ],
  },
  {
    version: "1.1.0",
    date: "June 2026",
    items: [
      "16×9 landscape recording — pick portrait or landscape in Studio; the overlay, library player, and exports match your format",
      "Cinematic cursor overhaul — smoother follow (One Euro + velocity limiting), sharper high-res cursor, slightly larger on screen",
      "Optional mouse click audio — mix click sounds into recordings with a Studio toggle and volume slider",
      "Faster Library — cached first-frame thumbnails, smoother scrolling, quicker film player load and fades",
      "Smarter viewport — softer panning at screen edges; gentler ease back to your cursor after Alt+F unfreeze",
      "720p @ 30fps defaults in Studio for a lighter starting point",
    ],
  },
  {
    version: "1.0.0",
    date: "June 2026",
    items: [
      "Complete desktop redesign — a slim collapsible dock with the vertical ninesixteen.video wordmark, icon tabs, and smooth expand/collapse animations",
      "Library film player slides out from behind the sidebar for a full 9×16 preview beside your takes; first-frame thumbnails in the filmstrip",
      "Live status stage during capture — countdown, recording timer, and saving state stay visible while the dock stays out of the way",
      "Info & feedback tab — account, updates, feedback, and legal links in one place",
      "Refreshed app icon on the installer, taskbar, and window",
      "Window controls stay accessible when expanded — close quits the app, minimize hides to the tray",
      "Alt + ↑ / ↓ zoom in and out again (alongside Alt + scroll)",
    ],
  },
  {
    version: "0.1.2",
    date: "June 2026",
    items: [
      "Audio sync fixed for good across every audio device — interfaces and outputs that stay silent between sounds (e.g. Steinberg UR22) now stay perfectly in time",
      "Recordings are locked to the wall clock in real time instead of being stretched to fit afterwards",
    ],
  },
  {
    version: "0.1.1",
    date: "June 2026",
    items: [
      "Fixed audio sync when your default output isn't 48 kHz (e.g. audio interfaces at 44.1 kHz)",
      "New 96 app icon on the installer, taskbar, and window",
      "Update prompt modal on startup when a newer build is available",
      "Refreshed 5-4-3-2-1 countdown with brand colors",
      "Download page notes for unsigned Windows installs",
    ],
  },
  {
    version: "0.1.0",
    date: "June 2026",
    items: [
      "Initial release — true 9×16 vertical capture with cursor framing",
      "Alt + scroll zoom, system & mic audio, encrypted local recordings",
      "Pro export ($49 one-time) shared with the web app",
      "In-app auto-update via GitHub Releases",
    ],
  },
] as const;

export const LATEST_VERSION = RELEASES.find((r) => !r.upcoming)?.version ?? "1.2.0";
