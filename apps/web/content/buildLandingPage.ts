import type { LandingPageConfig } from "./landingPageTypes";

export type LandingCatalogEntry = {
  slug: string;
  linkLabel: string;
  primaryKeyword: string;
  kicker: string;
  category: string;
  aspect: "portrait" | "landscape" | "both";
  audience?: string;
};

const ASPECT_LABEL = {
  portrait: "9×16 portrait",
  landscape: "16×9 landscape",
  both: "9×16 or 16×9",
} as const;

const ASPECT_SHORT = {
  portrait: "9×16",
  landscape: "16×9",
  both: "9×16 or 16×9",
} as const;

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildLandingPage(entry: LandingCatalogEntry): LandingPageConfig {
  const aspectLabel = ASPECT_LABEL[entry.aspect];
  const aspectShort = ASPECT_SHORT[entry.aspect];
  const kw = entry.primaryKeyword;
  const audience = entry.audience ?? "creators";

  const h1 = `${titleCase(kw)} on Windows — without the crop step`;
  const title = `${titleCase(kw)} for Windows — native ${aspectShort} capture`;
  const metaDescription = `Record ${kw} on Windows in native ${aspectShort}. Cursor-driven framing, Alt + scroll zoom, system + mic audio. Free to try · $49 one-time Pro export.`;

  const introVariants = [
    `${titleCase(kw)} needs footage that already fits the feed — not a widescreen dump you reframe in CapCut. ninesixteen.video captures ${aspectLabel} on Windows with a live overlay, cursor follow, and exports ready for ${audience}.`,
    `If you publish ${kw} content, your recorder should output ${aspectShort} from frame one. ninesixteen.video is a native Windows app built for tight framing: follow the cursor, zoom with Alt + scroll, and skip the post-production crop.`,
    `Windows screen recorders usually capture the whole desktop. For ${kw}, you want a deliberate ${aspectShort} viewport instead. ninesixteen.video records that region live — with cursor follow, Game mode, and Pro export when you are ready.`,
  ];
  const intro = introVariants[entry.slug.length % introVariants.length];

  const bullets: string[] = [
    `Native ${aspectShort} capture — built for ${kw}, not a center crop`,
    "Cursor-driven framing keeps the important UI in shot while you record",
    "Game mode locks the full frame for gameplay and fixed-view captures",
    "Alt + scroll zoom with rule-of-thirds guides, adjustable mid-take",
    "System + microphone audio with live meters; optional mouse click sounds",
    "Encrypted local library — preview before you export with Pro ($49 one-time)",
  ];

  if (entry.aspect === "portrait") {
    bullets.unshift("True vertical output for Shorts, Reels, TikTok, and Stories");
  } else if (entry.aspect === "landscape") {
    bullets.unshift("True widescreen output for YouTube, courses, and product demos");
  }

  const slugTokens = entry.slug.replace(/-screen-recorder|-recorder/g, "").split("-");
  const keywords = [
    kw,
    `${kw} windows`,
    `${slugTokens.slice(0, 3).join(" ")} screen recorder`,
    `${aspectShort} ${slugTokens[0] ?? "screen"} recorder`,
  ];

  return {
    slug: entry.slug,
    title,
    metaDescription,
    h1,
    kicker: entry.kicker,
    intro,
    bullets,
    keywords,
    linkLabel: entry.linkLabel,
    category: entry.category,
  };
}
