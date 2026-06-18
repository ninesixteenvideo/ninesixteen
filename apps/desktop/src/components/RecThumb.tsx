import { useEffect, useRef, useState } from "react";
import { recordingThumb } from "../lib/recordingThumb";
import type { Orientation } from "../lib/types";

/** Mini first-frame preview — same footprint as the old 9×16 label chip. */
export function RecThumb({ id, orientation }: { id: string; orientation: Orientation }) {
  const [src, setSrc] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const load = () => {
      void recordingThumb(id).then((data) => {
        if (!cancelled && data) setSrc(data);
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          load();
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [id]);

  return (
    <span
      ref={rootRef}
      className="rec-thumb"
      style={{ aspectRatio: orientation === "portrait" ? "9 / 16" : "16 / 9" }}
    >
      {src ? (
        <img src={src} alt="" className="rec-thumb-img" draggable={false} />
      ) : (
        <span className="rec-thumb-ph" aria-hidden />
      )}
    </span>
  );
}
