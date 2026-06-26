import {
  LEGAL_CONTACT_EMAIL,
  OPERATOR_LOCATION,
  OPERATOR_NAME,
  SERVICE_NAME,
} from "@/lib/legalMeta";

/** Canonical production URL; override with NEXT_PUBLIC_APP_URL on preview deploys. */
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://ninesixteen.video").replace(/\/$/, "");
}

export const SITE = {
  name: SERVICE_NAME,
  tagline: "Native 9×16 & 16×9 screen recorder for Windows",
  shortDescription:
    "Record your screen in true 9×16 or 16×9 with cursor-driven framing, Alt + scroll zoom, and Game mode for fixed-frame capture. Export up to 4K landscape @ 60 fps with a one-time $49 Pro license.",
  description:
    "ninesixteen.video is a native Windows screen recorder for true 9×16 portrait and 16×9 landscape capture. Frame with your cursor, zoom with Alt + scroll, lock the full frame in Game mode for gameplay, and export MP4s without cropping in post. Hardware-aware Studio settings, adaptive H.264 encoding, system and mic audio, virtual camera, and encrypted local recordings. Free to record and preview — $49 one-time for Pro export.",
  contactEmail: LEGAL_CONTACT_EMAIL,
  operatorName: OPERATOR_NAME,
  operatorLocation: OPERATOR_LOCATION,
  priceUsd: 49,
  currency: "USD",
  platforms: ["Windows 10", "Windows 11"],
  aspects: ["9×16 portrait", "16×9 landscape"],
  twitterHandle: "@ninesixteenvideo",
  githubUrl: "https://github.com/ninesixteenvideo/ninesixteen",
} as const;

export const SEO_KEYWORDS = [
  "vertical screen recorder",
  "landscape screen recorder",
  "9x16 screen recorder",
  "16x9 screen recorder",
  "game mode screen recorder",
  "tiktok screen recorder",
  "reels screen recorder",
  "youtube shorts recorder",
  "vertical video",
  "landscape video",
  "short form content",
  "saas demo recorder",
  "windows screen recorder",
  "native aspect ratio recorder",
  "cursor framing screen recorder",
  "OBS alternative vertical",
] as const;

export const RECORDING_QUALITY_SUMMARY =
  "720p–4K landscape · 1080p portrait · 30 or 60 fps — Studio recommends settings for your hardware";

export const PRODUCT_FEATURES = [
  "True 9×16 portrait and 16×9 landscape — what you frame is what you export",
  "Cursor-driven framing with Alt + scroll zoom and rule-of-thirds guides",
  "Game mode — locked full frame, no zoom; Crosshair or horizontal pan in portrait",
  "System and microphone audio with live level meters",
  "Optional mouse click audio in recordings",
  "Cinematic cursor for demos — system cursor in Game mode",
  "Encrypted local recordings with built-in library and film player",
  "Native Windows Graphics Capture — lightweight Tauri app, FFmpeg bundled",
  "Virtual camera for OBS, Zoom, and Google Meet",
  RECORDING_QUALITY_SUMMARY,
  "Adaptive H.264 — NVENC, AMD AMF, Intel QSV, or software fallback",
  "One-time $49 Pro export — no subscription",
] as const;

export const PRO_PRICING_FEATURES = [
  "Unlimited MP4 export to disk or Google Drive",
  "Up to 4K landscape and 1440p @ 60 fps",
  "1080p portrait at 30 or 60 fps",
  "Hardware-aware quality recommendations in Studio",
  "All current and future Pro features included",
  "Account links your license to the desktop app",
  "Free updates — no renewals",
] as const;

/** Secondary hero line — key differentiators below the main tagline. */
export const HERO_HIGHLIGHTS =
  "Game mode · cursor framing · up to 4K landscape · $49 one-time Pro";

/** Continuous broadcast ticker on the landing page hero. */
export const HOME_TICKER_ITEMS = [
  "True 9×16 & 16×9 capture",
  "Cursor framing · no crop in post",
  "Game mode for gameplay",
  "Alt + scroll zoom",
  "4K landscape Pro export",
  "1440p @ 60 fps",
  "Hardware-aware encoding",
  "System + mic audio",
  "Virtual camera for OBS & Zoom",
  "Encrypted local recordings",
  "$49 once · no subscription",
  "Free to try on Windows",
] as const;

import {
  FEATURED_USE_CASE_SLUGS,
  LANDING_PAGES,
} from "@/content/landingPages";

const FEATURED_SLUGS = new Set<string>(FEATURED_USE_CASE_SLUGS);

/** Public marketing routes included in sitemap.xml */
export const INDEXABLE_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/download", priority: 0.95, changeFrequency: "weekly" as const },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/faq", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/features", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/changelog", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/solutions", priority: 0.55, changeFrequency: "monthly" as const },
  ...LANDING_PAGES.map((page) => ({
    path: `/${page.slug}`,
    priority: FEATURED_SLUGS.has(page.slug) ? 0.88 : 0.72,
    changeFrequency: "monthly" as const,
  })),
  { path: "/compare/obs", priority: 0.82, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
] as const;
