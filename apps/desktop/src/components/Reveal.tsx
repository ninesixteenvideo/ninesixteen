import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

/** Matches --reveal-dur in styles.css (ms). */
const REVEAL_MS = 460;

export type RevealProps = {
  show: boolean;
  children: ReactNode;
  className?: string;
  /** @deprecated Size is tracked automatically via CSS grid. */
  trigger?: string;
  /** Fade/slide only — for flex-height panels (no height collapse). */
  fadeOnly?: boolean;
};

/**
 * Collapses and expands with height ease (0.46s) plus a short opacity / slide fade.
 * Uses CSS grid (0fr → 1fr) so nested content can grow without stale height clipping.
 */
export function Reveal({
  show,
  children,
  className = "",
  fadeOnly = false,
}: RevealProps) {
  const [mounted, setMounted] = useState(show);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    setOpen(false);
    const id = window.setTimeout(() => setMounted(false), REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [show]);

  useLayoutEffect(() => {
    if (!mounted) return;
    if (show) {
      const id = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(id);
    }
    setOpen(false);
  }, [show, mounted]);

  if (!mounted) return null;

  const classes = [
    "reveal",
    fadeOnly ? "reveal--fade" : "",
    open ? "reveal--open" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="reveal-inner">
        <div className="reveal-content">{children}</div>
      </div>
    </div>
  );
}
