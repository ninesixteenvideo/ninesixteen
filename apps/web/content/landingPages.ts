import { buildLandingPage } from "./buildLandingPage";
import { SEO_LANDING_CATALOG } from "./landingPageCatalog";
import type { LandingPageConfig } from "./landingPageTypes";
import {
  FEATURED_USE_CASE_SLUGS,
  getLandingPageLinkLabel,
} from "./landingPageTypes";

export type { LandingPageConfig } from "./landingPageTypes";
export { FEATURED_USE_CASE_SLUGS, getLandingPageLinkLabel } from "./landingPageTypes";

/** Hand-tuned flagship SEO pages (also included in the 100-page set). */
export const CORE_LANDING_PAGES: readonly LandingPageConfig[] = [
  {
    slug: "vertical-screen-recorder",
    title: "Vertical screen recorder for Windows — true 9×16 capture",
    metaDescription:
      "Record your screen in native 9×16 for TikTok, Reels, and YouTube Shorts. No crop in post — cursor-driven framing, Alt + scroll zoom, $49 one-time export.",
    h1: "The vertical screen recorder that skips the crop step",
    kicker: "9×16 native",
    linkLabel: "9×16 vertical",
    category: "format",
    intro:
      "Most recorders capture your full desktop — then you spend twenty minutes reframing in CapCut. ninesixteen.video records true 9×16 from frame one. Pick portrait in Studio, follow your cursor, and export footage that already fits Shorts, Reels, and TikTok.",
    bullets: [
      "True 9×16 — not a center crop of a 16×9 recording",
      "Cursor-driven framing so the viewport tracks what you point at",
      "Alt + scroll zoom with rule-of-thirds guides, live while recording",
      "System + mic audio, optional click sounds, encrypted local storage",
      "Free to record and preview · $49 one-time for MP4 export",
    ],
    keywords: [
      "vertical screen recorder",
      "9x16 screen recorder",
      "portrait screen recorder windows",
      "vertical video recorder",
    ],
  },
  {
    slug: "landscape-screen-recorder",
    title: "Landscape 16×9 screen recorder for Windows",
    metaDescription:
      "Record native 16×9 widescreen on Windows with cursor-driven framing. Perfect for SaaS demos, tutorials, and course content — no crop in post.",
    h1: "Native 16×9 screen recording on Windows",
    kicker: "16×9 landscape",
    linkLabel: "16×9 landscape",
    category: "format",
    intro:
      "You do not need a separate tool for widescreen demos. Switch to 16×9 in Studio and ninesixteen.video captures landscape-native footage with the same cursor framing workflow you use for vertical clips.",
    bullets: [
      "True 16×9 output — ready for YouTube, Loom-style demos, and course edits",
      "Same cursor follow and Alt + scroll zoom as portrait mode",
      "Library player and film dock adapt to landscape aspect",
      "Up to 1080p at 30 or 60 fps",
      "One app for both Shorts and widescreen — no subscription",
    ],
    keywords: [
      "landscape screen recorder",
      "16x9 screen recorder",
      "widescreen screen recorder windows",
      "horizontal screen recorder",
    ],
  },
  {
    slug: "tiktok-screen-recorder",
    title: "TikTok screen recorder for Windows — 9×16 native",
    metaDescription:
      "Best Windows screen recorder for TikTok creators. Record true 9×16 app demos, tutorials, and walkthroughs without cropping. Free to try, $49 one-time export.",
    h1: "Screen recordings that are already TikTok-ready",
    kicker: "TikTok · Reels · Shorts",
    linkLabel: "TikTok recorder",
    category: "platform",
    intro:
      "TikTok wants 9:16. Your monitor is not. ninesixteen.video bridges that gap — a live 9×16 overlay on your desktop, cursor-driven framing, and MP4 exports that drop straight into TikTok without a crop pass.",
    bullets: [
      "9×16 from the first frame — no black bars, no manual crop",
      "Frame tight on UI with cursor follow and live zoom",
      "System audio + voiceover in one take",
      "Lightweight native app — not another Electron hog",
      "Record free, export with Pro when you are ready to post",
    ],
    keywords: [
      "tiktok screen recorder",
      "record screen for tiktok",
      "tiktok tutorial recorder",
      "vertical tiktok capture windows",
    ],
  },
  {
    slug: "youtube-shorts-screen-recorder",
    title: "YouTube Shorts screen recorder for Windows",
    metaDescription:
      "Record YouTube Shorts in native 9×16 on Windows. Cursor framing, Alt + scroll zoom, system + mic audio. No post-production crop required.",
    h1: "YouTube Shorts screen capture without the crop pass",
    kicker: "YouTube Shorts",
    linkLabel: "YouTube Shorts",
    category: "platform",
    intro:
      "Shorts are vertical. Your screen recorder should be too. ninesixteen.video captures a true 9×16 region of your desktop — perfect for app demos, coding clips, and tutorial Shorts that look intentional, not cropped from a widescreen dump.",
    bullets: [
      "Native 9×16 MP4 exports for YouTube Shorts",
      "Follow your cursor — keep the UI that matters in frame",
      "Rule-of-thirds guides for composed shots mid-recording",
      "Encrypted local recordings — preview before you export",
      "$49 one-time Pro — no monthly fee eating your AdSense",
    ],
    keywords: [
      "youtube shorts screen recorder",
      "record screen for youtube shorts",
      "vertical youtube recorder windows",
      "shorts tutorial recorder",
    ],
  },
  {
    slug: "saas-demo-recorder",
    title: "SaaS demo screen recorder for founders — 9×16 & 16×9",
    metaDescription:
      "Record product demos and build-in-public clips in native 9×16 or 16×9. Cursor-driven framing for founders, indie hackers, and SaaS marketers on Windows.",
    h1: "Product demos that look shot on purpose",
    kicker: "Founders · SaaS · build in public",
    linkLabel: "SaaS demos",
    category: "business",
    intro:
      "Launch videos, feature drops, and progress updates need tight framing — not a shaky full-desktop screencast. ninesixteen.video follows your cursor, zooms with Alt + scroll, and exports portrait or landscape footage ready for X, LinkedIn, or your landing page.",
    bullets: [
      "Portrait for social clips · landscape for full product walkthroughs",
      "Cursor-driven viewport — viewers see what you point at",
      "Low CPU native capture — record on a laptop without fan spin-up",
      "Free to try before launch day — pay once when you need exports",
      "Built by a solo dev who ships in public",
    ],
    keywords: [
      "saas demo recorder",
      "product demo screen recorder",
      "build in public recorder",
      "startup demo video tool",
    ],
  },
] as const;

const CORE_SLUGS = new Set(CORE_LANDING_PAGES.map((p) => p.slug));

const GENERATED_LANDING_PAGES: LandingPageConfig[] = SEO_LANDING_CATALOG.filter(
  (entry) => !CORE_SLUGS.has(entry.slug),
).map((entry) => buildLandingPage(entry));

/** All SEO landing pages — 5 core + 95 generated = 100 */
export const LANDING_PAGES: readonly LandingPageConfig[] = [
  ...CORE_LANDING_PAGES,
  ...GENERATED_LANDING_PAGES,
];

export function getLandingPage(slug: string): LandingPageConfig | undefined {
  return LANDING_PAGES.find((page) => page.slug === slug);
}

export function getFeaturedUseCasePages(): LandingPageConfig[] {
  return FEATURED_USE_CASE_SLUGS.map(
    (slug) => LANDING_PAGES.find((p) => p.slug === slug)!,
  ).filter(Boolean);
}

export function getOtherLandingPages(): LandingPageConfig[] {
  const featured = new Set<string>(FEATURED_USE_CASE_SLUGS);
  return LANDING_PAGES.filter((page) => !featured.has(page.slug)).sort((a, b) =>
    getLandingPageLinkLabel(a).localeCompare(getLandingPageLinkLabel(b)),
  );
}

export function getRelatedLandingPages(
  page: LandingPageConfig,
  limit = 6,
): LandingPageConfig[] {
  const sameCategory = LANDING_PAGES.filter(
    (p) => p.slug !== page.slug && p.category === page.category,
  );
  const pool = sameCategory.length >= limit ? sameCategory : LANDING_PAGES.filter((p) => p.slug !== page.slug);
  return pool.slice(0, limit);
}

export const OBS_COMPARE = {
  title: "ninesixteen.video vs OBS for vertical & short-form recording",
  metaDescription:
    "Compare ninesixteen.video and OBS for TikTok, Reels, and YouTube Shorts. Native 9×16 capture, cursor framing, and one-time pricing vs manual crop workflows.",
  h1: "ninesixteen.video vs OBS",
  intro:
    "OBS is the Swiss Army knife of streaming — incredible, and overkill when you just need a tight vertical clip. Here is how ninesixteen.video compares for short-form and native-aspect screen recording on Windows.",
  rows: [
    {
      topic: "Native 9×16 / 16×9",
      ninesixteen: "Records true portrait or landscape from frame one",
      obs: "Records desktop or manual region — you crop in post",
    },
    {
      topic: "Framing workflow",
      ninesixteen: "Cursor-driven viewport + Alt + scroll zoom live",
      obs: "Static crop or manual scene switching",
    },
    {
      topic: "App weight",
      ninesixteen: "Lightweight Tauri app, Windows Graphics Capture",
      obs: "Full streaming suite, higher learning curve",
    },
    {
      topic: "Short-form speed",
      ninesixteen: "Record → preview → export to CapCut in minutes",
      obs: "Record → import → reframe → export",
    },
    {
      topic: "Pricing",
      ninesixteen: "Free to record · $49 one-time Pro export",
      obs: "Free and open source",
    },
    {
      topic: "Best for",
      ninesixteen: "TikTok, Reels, Shorts, SaaS demos, tutorials",
      obs: "Live streaming, multi-source productions, advanced setups",
    },
  ],
  verdict:
    "Use OBS when you need streams, multiple scenes, and plugins. Use ninesixteen.video when you want native vertical or landscape clips fast — without a crop step — and you are willing to pay once for clean exports.",
} as const;
