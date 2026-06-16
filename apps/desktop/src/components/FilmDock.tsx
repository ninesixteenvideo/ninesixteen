import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";
import { mediaSrc } from "../lib/bridge";

/** Free accounts can preview only the first slice of each recording. */
const FREE_PREVIEW_SECONDS = 15;
/** Must match the .film transition duration in styles.css. */
const SLIDE_MS = 520;

/**
 * The 9×16 player. It lives in the shell behind the sidebar and slides out
 * into the stage when a take is selected in the Library. Selecting a different
 * take retracts the current clip, swaps it, then slides the new one out — like
 * feeding a fresh strip of film.
 */
export function FilmDock({ onExtendedChange }: { onExtendedChange?: (out: boolean) => void }) {
  const { librarySelectedId, recordings, setPaywallOpen } = useStore();
  const { isPro } = useAuth();

  const [shownId, setShownId] = useState<string | null>(null);
  const [out, setOut] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const target = librarySelectedId;

  useEffect(() => {
    if (out) {
      onExtendedChange?.(true);
      return;
    }
    const t = window.setTimeout(() => onExtendedChange?.(false), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [out, onExtendedChange]);

  // Drive the slide-in / swap / slide-out sequence off the selected id.
  useEffect(() => {
    window.clearTimeout(timer.current);
    let cancelled = false;
    let raf = 0;

    if (!target) {
      setOut(false);
      timer.current = window.setTimeout(() => {
        if (!cancelled) setShownId(null);
      }, SLIDE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timer.current);
      };
    }

    if (shownId !== target) {
      if (shownId !== null) {
        setOut(false);
        timer.current = window.setTimeout(() => {
          if (!cancelled) setShownId(target);
        }, SLIDE_MS);
        return () => {
          cancelled = true;
          window.clearTimeout(timer.current);
        };
      }
      setShownId(target);
      return;
    }

    // Window is already wide on the Library tab — animate the strip out.
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        if (!cancelled) setOut(true);
      });
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, shownId]);

  // Resolve the playable URL for whatever clip is currently mounted.
  useEffect(() => {
    setCapReached(false);
    setErr(null);
    if (!shownId) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const resolved = await mediaSrc(shownId);
      if (!cancelled) setSrc(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [shownId]);

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) videoRef.current?.pause();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const shown = useMemo(
    () => recordings.find((r) => r.id === shownId) ?? null,
    [recordings, shownId]
  );

  function enforcePreviewCap() {
    if (isPro) return;
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime >= FREE_PREVIEW_SECONDS) {
      if (v.currentTime > FREE_PREVIEW_SECONDS) v.currentTime = FREE_PREVIEW_SECONDS;
      if (!v.paused) v.pause();
      setCapReached(true);
    }
  }

  function replayPreview() {
    const v = videoRef.current;
    if (!v) return;
    setCapReached(false);
    v.currentTime = 0;
    void v.play().catch(() => {});
  }

  return (
    <div
      className={`film ${shown ? "mounted" : ""} ${out ? "out" : ""}`}
      aria-hidden={!out}
    >
      {shown && (
        <div className="film-inner">
          {src ? (
            <div className="film-clip">
              <video
                key={shown.id}
                ref={videoRef}
                className="film-player"
                src={src}
                controls
                autoPlay
                onTimeUpdate={enforcePreviewCap}
                onSeeking={enforcePreviewCap}
                onError={() =>
                  setErr(
                    "Could not load this recording. Rebuild the app if playback recently broke — the release CSP must allow https://nsmedia.localhost."
                  )
                }
                style={{ aspectRatio: shown.orientation === "portrait" ? "9 / 16" : "16 / 9" }}
              />
            </div>
          ) : (
            <div className="film-clip">
              <div className="film-loading" aria-label="Loading preview">
                <span className="film-loading-dot" />
              </div>
            </div>
          )}

          {!isPro && capReached && src && (
            <div className="cap-overlay">
              <span className="cap-badge">Free preview</span>
              <p className="cap-title">That&apos;s the first {FREE_PREVIEW_SECONDS} seconds</p>
              <p className="cap-sub">
                Upgrade to Pro to watch the full recording and export it without a watermark.
              </p>
              <div className="cap-actions">
                <button className="btn primary sm" onClick={() => setPaywallOpen(true)}>
                  Upgrade to Pro
                </button>
                <button className="btn ghost sm" onClick={replayPreview}>
                  Replay preview
                </button>
              </div>
            </div>
          )}

          {err && <p className="film-err">{err}</p>}
        </div>
      )}
    </div>
  );
}
