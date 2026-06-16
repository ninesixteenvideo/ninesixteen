/**
 * ninesixteen.video — brand design tokens.
 *
 * Monochrome charcoal + white UI. Colour lives in the wordmark (mint + coral)
 * and the coral record / Pro accent. Shared by web and desktop.
 */

export const colors = {
  // Surfaces — warm charcoal, layered for depth
  bg: "#121110",
  bgAlt: "#1A1917",
  surface: "#262421",
  surfaceSunken: "#1E1D1B",
  surfaceHi: "#2F2D29",
  hover: "#34322D",

  // Ink
  ink: "#F4F3F0",
  inkSoft: "#A8A6A0",
  inkFaint: "#6F6D67",

  // Inverted selection (primary buttons, active tabs)
  sel: "#F4F3F0",
  selInk: "#191816",

  // Wordmark syllables + functional accent (record dot, Pro CTAs)
  mint: "#78FFD4",
  coral: "#FF6B58",

  // Legacy aliases — keep exports stable for Wordmark + existing imports
  white: "#FFFFFF",
  blue: "#78FFD4",
  blueDeep: "#78FFD4",
  pink: "#FF6B58",
  pinkDeep: "#FF9E92",
  yellow: "#F4F3F0",
  onAccent: "#F4F3F0",
  onBright: "#191816",
  shadow: "#0A0908",

  // Structure
  line: "rgba(255, 255, 255, 0.09)",
  lineSoft: "rgba(255, 255, 255, 0.16)",
  lineHi: "rgba(255, 255, 255, 0.16)",

  danger: "#E0635F",
  success: "#5FA37E",
} as const;

export const fonts = {
  display: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace',
  wordmark: 'var(--font-bungee, "Bungee"), system-ui, sans-serif',
  wordmarkVideo: 'var(--font-faster-one, "Faster One"), system-ui, sans-serif',
} as const;

export const radii = {
  xs: "6px",
  sm: "9px",
  md: "12px",
  lg: "16px",
  pill: "999px",
} as const;

export const shadows = {
  soft: "0 8px 32px -12px rgba(0, 0, 0, 0.55)",
  rail: "8px 0 32px -12px rgba(0, 0, 0, 0.55)",
  /** @deprecated hard shadows removed in v1.0 — kept for type compat */
  hard: `0 8px 32px -12px rgba(0, 0, 0, 0.55)`,
  hardLg: `0 12px 40px -12px rgba(0, 0, 0, 0.6)`,
  hardBlue: `0 8px 32px -12px rgba(0, 0, 0, 0.55)`,
  hardPink: `0 8px 32px -12px rgba(0, 0, 0, 0.55)`,
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
