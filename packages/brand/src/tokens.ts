/**
 * ninesixteen.video — brand design tokens.
 *
 * Retro-inspired, light-mode only. The wordmark splits into three syllables:
 *   "nine"  -> white (with a hard retro outline so it reads on light grey)
 *   "six"   -> neon/pastel blue
 *   "teen"  -> neon/pastel pink
 *
 * These tokens are the single source of truth shared by the web app and the
 * Tauri desktop app so the two surfaces stay visually identical.
 */

export const colors = {
  // Surfaces
  bg: "#ECEAE4", // light warm grey page background
  bgAlt: "#E3E0D8", // slightly deeper grey for sections
  surface: "#F7F5F0", // cards / panels
  surfaceSunken: "#EAE7DF",

  // Ink
  ink: "#17171B", // near-black primary text + retro outlines
  inkSoft: "#54535C", // secondary text
  inkFaint: "#8A8893",

  // Brand syllables
  white: "#FFFFFF",
  blue: "#3FC4F0", // "six" — neon/pastel blue
  blueDeep: "#16A6D6",
  pink: "#FF7FC4", // "teen" — neon/pastel pink
  pinkDeep: "#F24FA6",

  // Accents
  yellow: "#FFCE4A", // retro sunburst accent
  mint: "#74E0B5",

  // Utility
  line: "#17171B",
  lineSoft: "#CFCBC0",
  danger: "#E5484D",
  success: "#46A758",
} as const;

export const fonts = {
  /** Display / logo — memorable retro geometric face. */
  display: '"Righteous", "Bungee", system-ui, sans-serif',
  /** Body copy — clean, slightly geometric companion. */
  body: '"Space Grotesk", "Inter", system-ui, sans-serif',
  /** Mono for technical/recording metadata. */
  mono: '"Space Mono", "JetBrains Mono", ui-monospace, monospace',
} as const;

export const radii = {
  sm: "8px",
  md: "14px",
  lg: "22px",
  pill: "999px",
} as const;

/** Hard-offset "retro" shadows (no blur) plus a soft ambient option. */
export const shadows = {
  hard: `4px 4px 0 ${colors.ink}`,
  hardLg: `7px 7px 0 ${colors.ink}`,
  hardBlue: `4px 4px 0 ${colors.blueDeep}`,
  hardPink: `4px 4px 0 ${colors.pinkDeep}`,
  soft: "0 10px 30px rgba(23,23,27,0.10)",
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
