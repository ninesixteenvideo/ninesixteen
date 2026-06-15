import React from "react";
import { colors, fonts } from "./tokens";

export type WordmarkProps = {
  /** Font size of the wordmark in px (everything scales from this). */
  size?: number;
  /** Show the ".video" suffix after "ninesixteen". */
  showSuffix?: boolean;
  /** Override color for "nine" (default: light mint). */
  nineColor?: string;
  /** Override color for "sixteen" (default: coral). */
  sixteenColor?: string;
  /** Override color for ".video" (default: off-white). */
  suffixColor?: string;
  /** Optional className passthrough. */
  className?: string;
  style?: React.CSSProperties;
  title?: string;
};

/**
 * ninesixteen.video wordmark — "nine" (mint) + "sixteen" (coral) + ".video" (white).
 * Self-contained inline styles so it renders identically in web + desktop.
 */
export function Wordmark({
  size = 40,
  showSuffix = false,
  nineColor = colors.blue,
  sixteenColor = colors.pink,
  suffixColor = colors.ink,
  className,
  style,
  title = "ninesixteen.video",
}: WordmarkProps) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    userSelect: "none",
    whiteSpace: "nowrap",
    lineHeight: 1,
  };

  const brand: React.CSSProperties = {
    fontFamily: fonts.wordmark,
    fontSize: size,
    fontWeight: 400,
    letterSpacing: "-0.02em",
  };

  return (
    <span className={className} style={{ ...base, ...style }} title={title} aria-label={title}>
      <span style={{ ...brand, color: nineColor }}>nine</span>
      <span style={{ ...brand, color: sixteenColor }}>sixteen</span>
      {showSuffix && <span style={{ ...brand, color: suffixColor }}>.video</span>}
    </span>
  );
}

export default Wordmark;
