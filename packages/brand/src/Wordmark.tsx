import React from "react";
import { colors, fonts } from "./tokens";

export type WordmarkProps = {
  /** Font size of the wordmark in px (everything scales from this). */
  size?: number;
  /** Show the "video" suffix after "ninesixteen." */
  showSuffix?: boolean;
  /** Optional className passthrough. */
  className?: string;
  style?: React.CSSProperties;
  title?: string;
};

/**
 * ninesixteen.video wordmark — "ninesixteen." (Tourney, cream) + "video" (Faster One, red).
 * Self-contained inline styles so it renders identically in web + desktop.
 */
export function Wordmark({
  size = 40,
  showSuffix = false,
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
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: colors.ink,
  };

  const video: React.CSSProperties = {
    fontFamily: fonts.wordmarkVideo,
    fontSize: size * 0.58,
    fontWeight: 400,
    letterSpacing: "0.04em",
    color: colors.pink,
    marginLeft: size * 0.04,
    transform: "translateY(0.04em)",
  };

  return (
    <span className={className} style={{ ...base, ...style }} title={title} aria-label={title}>
      <span style={brand}>ninesixteen{showSuffix ? "." : ""}</span>
      {showSuffix && <span style={video}>video</span>}
    </span>
  );
}

export default Wordmark;
