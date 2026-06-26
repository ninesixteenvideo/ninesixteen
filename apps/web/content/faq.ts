export type FaqItem = {
  question: string;
  answer: string;
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "What is ninesixteen.video?",
    answer:
      "ninesixteen.video is a native Windows screen recorder for true 9×16 portrait and 16×9 landscape capture. You frame with your cursor, zoom with Alt + scroll, lock the full frame in Game mode for gameplay, and export MP4s without cropping in post. Record and preview free; Pro export is a one-time $49 purchase.",
  },
  {
    question: "How is ninesixteen different from OBS or generic screen recorders?",
    answer:
      "OBS records your full desktop or a manual crop — you still reframe for Shorts, Reels, or TikTok. ninesixteen records natively in 9×16 or 16×9 from frame one, follows your cursor for intentional framing, and ships a lightweight Tauri app with Windows Graphics Capture for lower CPU use. OBS is better for live streaming and multi-source setups.",
  },
  {
    question: "Do I need to crop video for TikTok, Reels, or YouTube Shorts?",
    answer:
      "No. Pick 9×16 in Studio before you record. The live overlay, capture region, and exported MP4 are already vertical — no letterboxing and no crop step in your editor.",
  },
  {
    question: "Can I record widescreen 16×9 demos and tutorials?",
    answer:
      "Yes. Switch to 16×9 in Studio for SaaS demos, course walkthroughs, or any widescreen edit. Same cursor framing workflow — native aspect from frame one.",
  },
  {
    question: "What is Game mode?",
    answer:
      "Game mode locks the full 9×16 or 16×9 frame with zoom disabled — built for gameplay and fixed-view captures. In portrait, choose Crosshair to keep the frame centered, or Cursor to pan horizontally as you move. Recordings use your system cursor, not the cinematic pointer.",
  },
  {
    question: "Is there a subscription or is it one-time?",
    answer:
      "One-time. Pro is $49 USD with no renewals. You own every export forever, including future Pro features. Recording and in-app preview stay free without an account.",
  },
  {
    question: "Can I try before buying Pro?",
    answer:
      "Yes. Download the Windows app, record, and preview clips locally without signing in. Purchase Pro only when you want to export decrypted MP4 files to disk or Google Drive.",
  },
  {
    question: "What are the Windows system requirements?",
    answer:
      "Windows 10 or 11 (64-bit), WebView2 (the installer sets this up), 8 GB RAM minimum (16 GB recommended), DirectX 11 GPU with 2 GB VRAM, 1920×1080 display or higher, and ~500 MB free disk for the app. Studio recommends quality settings based on your hardware.",
  },
  {
    question: "Where are recordings stored?",
    answer:
      "On your machine, encrypted at rest under your user Videos folder. Nothing uploads until you choose to export with Pro. The app is local-first by design.",
  },
  {
    question: "Why does Windows SmartScreen warn about the installer?",
    answer:
      "The installer is not code-signed yet (working on it). SmartScreen may show an unknown publisher warning — click More info, then Run anyway. You are downloading directly from ninesixteen.video.",
  },
  {
    question: "Does it support macOS or Linux?",
    answer:
      "Not yet. ninesixteen.video is Windows-only today. macOS and Linux are on the roadmap.",
  },
  {
    question: "What resolution and frame rates are supported?",
    answer:
      "Portrait: up to 1080p at 30 or 60 fps. Landscape: 720p through 4K at 30 or 60 fps — including 1440p and 4K @ 60 fps with Pro export. Studio defaults to 720p @ 30 fps and recommends the highest settings your PC can encode reliably, using adaptive H.264 (NVENC, AMD AMF, Intel QSV, or software fallback).",
  },
  {
    question: "Can I use ninesixteen as a virtual camera in OBS or Zoom?",
    answer:
      "Yes. Enable the virtual camera in the app and select ninesixteen.video in OBS, Zoom, Google Meet, or any app that picks a webcam. Screen capture starts when that app opens the camera feed.",
  },
] as const;
