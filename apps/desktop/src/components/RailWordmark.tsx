import { useEffect, useRef, useState, type CSSProperties } from "react";
import { colors, fonts } from "@ninesixteen/brand";
import type { Orientation } from "../lib/types";

/** Total fade-out + fade-in — keep in sync with styles.css */
export const RAIL_WORDMARK_SWAP_MS = 560;
const FADE_HALF_MS = RAIL_WORDMARK_SWAP_MS / 2;

type RailWordmarkProps = {
  orientation: Orientation;
  size?: number;
};

const brandStyle = (size: number): CSSProperties => ({
  fontFamily: fonts.wordmark,
  fontSize: size,
  fontWeight: 400,
  letterSpacing: "-0.02em",
  lineHeight: 1,
});

function domainTitle(landscape: boolean) {
  return landscape ? "sixteennine.video" : "ninesixteen.video";
}

function WordmarkLabel({ landscape, size }: { landscape: boolean; size: number }) {
  const brand = brandStyle(size);
  const first = landscape
    ? { text: "sixteen", color: colors.pink }
    : { text: "nine", color: colors.blue };
  const second = landscape
    ? { text: "nine", color: colors.blue }
    : { text: "sixteen", color: colors.pink };

  return (
    <>
      <span className="rail-wm-part rail-wm-part-a" style={{ ...brand, color: first.color }}>
        {first.text}
      </span>
      <span className="rail-wm-part rail-wm-part-b" style={{ ...brand, color: second.color }}>
        {second.text}
      </span>
      <span className="rail-wm-suffix" style={{ ...brand, color: colors.ink }}>
        .video
      </span>
    </>
  );
}

/**
 * Vertical rail wordmark — ninesixteen.video (9×16) ↔ sixteennine.video (16×9).
 * Crossfades on orientation change.
 */
export function RailWordmark({ orientation, size = 24 }: RailWordmarkProps) {
  const landscape = orientation === "landscape";
  const timer = useRef<number | undefined>(undefined);
  const [shownLandscape, setShownLandscape] = useState(landscape);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (landscape === shownLandscape) return;

    setVisible(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setShownLandscape(landscape);
      setVisible(true);
    }, FADE_HALF_MS);

    return () => window.clearTimeout(timer.current);
  }, [landscape, shownLandscape]);

  const title = domainTitle(shownLandscape);

  return (
    <span
      className={`rail-wm vmark${visible ? "" : " rail-wm--faded"}`}
      title={title}
      aria-label={title}
    >
      <span className="rail-wm-core">
        <WordmarkLabel landscape={shownLandscape} size={size} />
      </span>
    </span>
  );
}
