import { useEffect, useRef, useState, type CSSProperties } from "react";
import { colors, fonts } from "@ninesixteen/brand";
import type { Orientation } from "../lib/types";

const SWAP_MS = 680;

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

function Syllables({
  landscape,
  size,
  className,
}: {
  landscape: boolean;
  size: number;
  className?: string;
}) {
  const brand = brandStyle(size);
  const first = landscape ? "sixteen" : "nine";
  const second = landscape ? "nine" : "sixteen";

  return (
    <span className={className}>
      <span
        className="rail-wm-part rail-wm-a"
        style={{ ...brand, color: first === "nine" ? colors.blue : colors.pink }}
      >
        {first}
      </span>
      <span
        className="rail-wm-part rail-wm-b"
        style={{ ...brand, color: second === "nine" ? colors.blue : colors.pink }}
      >
        {second}
      </span>
    </span>
  );
}

/**
 * Vertical rail wordmark — ninesixteen.video (portrait) ↔ sixteennine.video (landscape).
 * Syllables cross-fade while ".video" stays anchored.
 */
export function RailWordmark({ orientation, size = 24 }: RailWordmarkProps) {
  const landscape = orientation === "landscape";
  const [shown, setShown] = useState(landscape);
  const [leaving, setLeaving] = useState<boolean | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (landscape === shown) return;

    setLeaving(shown);
    setShown(landscape);

    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [window.setTimeout(() => setLeaving(null), SWAP_MS)];

    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [landscape, shown]);

  const title = shown ? "sixteennine.video" : "ninesixteen.video";

  return (
    <span className="rail-wm vmark" title={title} aria-label={title}>
      <span className="rail-wm-core">
        {leaving !== null && (
          <Syllables
            landscape={leaving}
            size={size}
            className="rail-wm-syllables rail-wm-face rail-wm-face--leave"
          />
        )}
        <Syllables
          landscape={shown}
          size={size}
          className={`rail-wm-syllables rail-wm-face rail-wm-face--enter${
            leaving !== null ? " rail-wm-face--active" : ""
          }`}
        />
      </span>
      <span className="rail-wm-suffix" style={{ ...brandStyle(size), color: colors.ink }}>
        .video
      </span>
    </span>
  );
}
