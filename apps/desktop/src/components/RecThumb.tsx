import { useEffect, useState } from "react";
import { recordingThumb } from "../lib/recordingThumb";
import type { Orientation } from "../lib/types";

/** Mini first-frame preview — same footprint as the old 9×16 label chip. */
export function RecThumb({ id, orientation }: { id: string; orientation: Orientation }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void recordingThumb(id).then((data) => {
      if (!cancelled && data) setSrc(data);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <span
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
