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
  // Surfaces
  bg: "#F4F3EF",
  bgAlt: "#EAE8E2",
  surface: "#FAFAF8",
  surfaceSunken: "#EFEDE8",

  // Ink & structure (dark charcoal — not pure black)
  ink: "#323238",
  inkSoft: "#5C5C66",
  inkFaint: "#878792",

  // Brand syllables + UI accents
  white: "#FFFFFF",
  blue: "#6E6E78",
  blueDeep: "#565660",
  pink: "#8F5E55",
  pinkDeep: "#6E443D",

  // Accents
  yellow: "#FFCE4A",
  mint: "#6B9E8A",

  // Utility
  line: "#323238",
  lineSoft: "#D5D2CB",
  danger: "#B84A4F",
  success: "#3D7355",
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
  hard: `4px 4px 0 ${colors.ink}`,
  hardLg: `7px 7px 0 ${colors.ink}`,
  hardBlue: `4px 4px 0 ${colors.blueDeep}`,
  hardPink: `4px 4px 0 ${colors.pinkDeep}`,
  soft: "0 10px 30px rgba(50,50,56,0.08)",
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
export const tagline = "Record & stream your desktop. Frame it with your other hand.";

export type Tokens = {
  colors: typeof colors;
  fonts: typeof fonts;
  radii: typeof radii;
  shadows: typeof shadows;
  space: typeof space;
};

export const tokens: Tokens = { colors, fonts, radii, shadows, space };
