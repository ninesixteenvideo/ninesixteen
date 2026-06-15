/**
 * ninesixteen.video — brand design tokens.
 *
 * Professional stone palette with mild retro structure (hard shadows, pill radii).
 * Wordmark syllables:
 *   "nine"  -> white (outlined on light backgrounds)
 *   "six"   -> medium charcoal
 *   "teen"  -> terracotta clay
 *
 * Shared by the web app and Tauri desktop app.
 */

export const colors = {
  // Surfaces (neutral warm charcoal — no blue/violet tint)
  bg: "#1B1A18",
  bgAlt: "#242220",
  surface: "#2C2A27",
  surfaceSunken: "#201F1C",

  // Ink & structure (warm dark cream — text + brutalist outlines)
  ink: "#E7D8B6",
  inkSoft: "#B0A994",
  inkFaint: "#7C7565",

  // Deep shade used for retro outlines / hard-offset shadows on dark
  shadow: "#0C0B0A",

  // Text colour that sits on accents
  onAccent: "#E7D8B6",
  onBright: "#1B1A18",

  // Brand syllables + UI accents
  white: "#FFFFFF",
  blue: "#6D6A65",
  blueDeep: "#A7A19A",
  pink: "#A35D4D",
  pinkDeep: "#84493B",

  // Accents
  yellow: "#E7D8B6",
  mint: "#74B29A",

  // Utility
  line: "#E7D8B6",
  lineSoft: "#38352F",
  danger: "#E0635F",
  success: "#5FA37E",
} as const;

export const fonts = {
  /** Headings, buttons, and logo — Inter semibold for a clean pro feel. */
  display: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  /** Body copy — Inter for maximum readability. */
  body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  /** Mono for technical/recording metadata. */
  mono: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace',
} as const;

export const radii = {
  sm: "8px",
  md: "14px",
  lg: "22px",
  pill: "999px",
} as const;

/** Hard-offset shadows (no blur) plus a soft ambient option. */
export const shadows = {
  hard: `4px 4px 0 ${colors.shadow}`,
  hardLg: `7px 7px 0 ${colors.shadow}`,
  hardBlue: `4px 4px 0 ${colors.blueDeep}`,
  hardPink: `4px 4px 0 ${colors.pinkDeep}`,
  soft: "0 14px 40px rgba(0,0,0,0.45)",
} as const;

export const space = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
  xxl: "72px",
} as const;

export const aspect = {
  landscape: { w: 16, h: 9, label: "16×9" },
  portrait: { w: 9, h: 16, label: "9×16" },
} as const;

export const brandName = "ninesixteen.video";
export const tagline = "Vertical desktop capture for Shorts, Reels, and TikTok.";

export type Tokens = {
  colors: typeof colors;
  fonts: typeof fonts;
  radii: typeof radii;
  shadows: typeof shadows;
  space: typeof space;
};

export const tokens: Tokens = { colors, fonts, radii, shadows, space };
