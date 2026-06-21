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
    "Record your screen in true 9×16 or 16×9 — no cropping in post. Cursor-driven framing, Alt + scroll zoom, local encrypted recordings.",
  description:
    "Record your screen in true 9×16 or 16×9 — no cropping in post. Frame with your cursor, zoom with Alt + scroll, and capture footage ready for Shorts, Reels, TikTok, or widescreen edits. Free to try, $49 one-time purchase.",
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
  "tiktok screen recorder",
  "reels screen recorder",
  "youtube shorts recorder",
  "vertical video",
  "landscape video",
  "short form content",
  "saas demo recorder",
  "build in public",
  "windows screen recorder",
  "native aspect ratio recorder",
  "cursor framing screen recorder",
  "OBS alternative vertical",
] as const;

export const PRODUCT_FEATURES = [
  "True 9×16 or 16×9 capture with cursor-driven framing",
  "Alt + scroll zoom with rule-of-thirds guides",
  "System and microphone audio with live level meters",
  "Optional mouse click audio in recordings",
  "Encrypted local recordings with built-in preview",
  "Native Windows Graphics Capture — low CPU, not Electron",
  "FFmpeg bundled — nothing else to install",
  "Virtual camera for OBS, Zoom, and Meet",
  "Up to 1080p at 30 or 60 fps",
  "One-time $49 Pro export — no subscription",
] as const;

/** Continuous broadcast ticker on the landing page hero. */
export const HOME_TICKER_ITEMS = [
  "True 9×16 & 16×9 capture",
  "Cursor-driven framing",
  "What you frame is what you export",
  "No crop in post",
  "Alt + scroll to zoom",
  "Rule-of-thirds guides",
  "Portrait or landscape in Studio",
  "System + mic audio",
  "Optional mouse click sounds",
  "Encrypted local recordings",
  "Built-in library preview",
  "Native Windows capture — not Electron",
  "FFmpeg bundled · nothing else to install",
  "Virtual camera for OBS, Zoom & Meet",
  "1080p · 30 or 60 fps",
  "Smoother cinematic cursor",
  "Free to try on Windows",
  "$49 once · no subscription",
  "Private & local-first",
  "Short-form & widescreen ready",
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
