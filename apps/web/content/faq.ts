export type FaqItem = {
  question: string;
  answer: string;
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "What is ninesixteen.video?",
    answer:
      "ninesixteen.video is a native Windows screen recorder built for true 9×16 portrait and 16×9 landscape capture. You frame with your cursor, zoom with Alt + scroll, and export MP4s without cropping or reframing in post. Record and preview free; Pro export is a one-time $49 purchase.",
  },
  {
    question: "How is ninesixteen different from OBS or generic screen recorders?",
    answer:
      "OBS records your full desktop or a manual crop — you still reframe for Shorts, Reels, or TikTok. ninesixteen records natively in 9×16 or 16×9 from frame one, follows your cursor for intentional framing, and ships a lightweight Tauri app (not Electron) with Windows Graphics Capture for lower CPU use.",
  },
  {
    question: "Do I need to crop video for TikTok, Reels, or YouTube Shorts?",
    answer:
      "No. Pick 9×16 in Studio before you record. The live overlay, capture region, and exported MP4 are already vertical — zero letterboxing and zero crop step in CapCut, Premiere, or your editor.",
  },
  {
    question: "Can I record widescreen 16×9 demos and tutorials?",
    answer:
      "Yes. Version 1.1.0 adds a landscape format toggle in Studio. Switch to 16×9 for SaaS demos, course walkthroughs, or any widescreen edit — same cursor framing workflow, native aspect from frame one.",
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
      "Windows 10 or 11 (64-bit), WebView2 (the installer sets this up), 8 GB RAM minimum (16 GB recommended), DirectX 11 GPU with 2 GB VRAM, 1920×1080 display or higher, and ~500 MB free disk for the app.",
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
      "Up to 1080p at 30 or 60 fps. Studio defaults to 720p at 30 fps for a lighter starting point — change quality anytime before recording.",
  },
  {
    question: "Can I use ninesixteen as a virtual camera in OBS or Zoom?",
    answer:
      "Yes. Enable the virtual camera in the app and select ninesixteen.video in OBS, Zoom, Google Meet, or any app that picks a webcam. Screen capture starts when that app opens the camera feed.",
  },
] as const;
