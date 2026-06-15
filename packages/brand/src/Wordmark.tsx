import React from "react";
import { colors, fonts } from "./tokens";

export type WordmarkProps = {
  /** Font size of the wordmark in px (everything scales from this). */
  size?: number;
  /** Show the ".video" domain suffix after the wordmark. */
  showSuffix?: boolean;
  /** Optional className passthrough. */
  className?: string;
  style?: React.CSSProperties;
  title?: string;
};

/**
 * The ninesixteen wordmark: "nine" (white, outlined) + "six" (charcoal) + "teen" (clay).
 * Self-contained inline styles so it renders identically in any React app
 * without depending on global CSS being loaded first.
 */
export function Wordmark({
  size = 40,
  showSuffix = false,
  className,
  style,
  title = "ninesixteen.video",
}: WordmarkProps) {
  const base: React.CSSProperties = {
    fontFamily: fonts.display,
    fontSize: size,
    lineHeight: 1,
    letterSpacing: "-0.025em",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "baseline",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  // "nine" is white — on the dark bg it gets a deep retro outline + offset emboss.
  const edge = colors.shadow;
  const outline =
    "-1px -1px 0 " +
    edge +
    ", 1px -1px 0 " +
    edge +
    ", -1px 1px 0 " +
    edge +
    ", 1px 1px 0 " +
    edge;

  const nine: React.CSSProperties = {
    color: colors.ink,
    textShadow: `${outline}, ${Math.max(2, size * 0.06)}px ${Math.max(
      2,
      size * 0.06
    )}px 0 ${edge}`,
  };
  // "six" stays warm charcoal (independent of the UI accent token, which is red).
  const six: React.CSSProperties = {
    color: "#6D6A65",
    textShadow: `0 0 ${size * 0.16}px rgba(140, 134, 126, 0.45)`,
  };
  const teen: React.CSSProperties = {
    color: colors.pink,
    textShadow: `0 0 ${size * 0.16}px rgba(163, 93, 77, 0.5)`,
  };
  const suffix: React.CSSProperties = {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: size * 0.4,
    marginLeft: size * 0.06,
    transform: "translateY(-0.06em)",
  };

  return (
    <span className={className} style={{ ...base, ...style }} title={title} aria-label={title}>
      <span style={nine}>nine</span>
      <span style={six}>six</span>
      <span style={teen}>teen</span>
      {showSuffix && <span style={suffix}>.video</span>}
    </span>
  );
}

export default Wordmark;
