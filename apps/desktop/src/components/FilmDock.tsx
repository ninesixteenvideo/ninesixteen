import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";
import { mediaSrc } from "../lib/bridge";
import { FILM_FADE_MS } from "../lib/windowDock";
import { PlayIcon } from "./icons";
import type { Orientation } from "../lib/types";

/** Free accounts can preview only the first slice of each recording. */
const FREE_PREVIEW_SECONDS = 15;

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function afterPaint() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

export type FilmDockHandle = {
  /** Fade the player out; resolves when the transition finishes. */
  fadeOut: () => Promise<void>;
};

/**
 * The film player. It lives beside the sidebar on the Library tab. Selection
 * changes and orientation swaps cross-fade; tab/collapse calls fadeOut first.
 */
export const FilmDock = forwardRef<
  FilmDockHandle,
  { onExtendedChange?: (visible: boolean) => void }
>(function FilmDock({ onExtendedChange }, ref) {
  const { librarySelectedId, recordings, setPaywallOpen } = useStore();
  const { isPro } = useAuth();

  const [shownId, setShownId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [fade, setFade] = useState<"in" | "out">("out");
  const [src, setSrc] = useState<string | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shownIdRef = useRef(shownId);
  const fadeRef = useRef(fade);
  const fadeOutPromiseRef = useRef<Promise<void> | null>(null);
  const seqRef = useRef(0);

  shownIdRef.current = shownId;
  fadeRef.current = fade;

  const target = librarySelectedId;

  useImperativeHandle(ref, () => ({
    fadeOut: () => {
      if (!shownIdRef.current) return Promise.resolve();
      if (fadeOutPromiseRef.current) return fadeOutPromiseRef.current;
      setFade("out");
      const p = sleep(FILM_FADE_MS).then(() => {
        fadeOutPromiseRef.current = null;
        onExtendedChange?.(false);
      });
      fadeOutPromiseRef.current = p;
      return p;
    },
  }));

  useEffect(() => {
    const seq = ++seqRef.current;
    const alive = () => seq === seqRef.current;

    void (async () => {
      if (!target) {
        if (!shownIdRef.current) return;
        if (fadeRef.current !== "out") {
          setFade("out");
          await sleep(FILM_FADE_MS);
        }
        if (!alive()) return;
        setShownId(null);
        setSrc(null);
        setCapReached(false);
        setPlaying(false);
        setErr(null);
        onExtendedChange?.(false);
        return;
      }

      setErr(null);
      let url: string;
      try {
        url = await mediaSrc(target);
      } catch (e) {
        if (!alive()) return;
        setErr(e instanceof Error ? e.message : "Could not resolve playback URL");
        return;
      }
      if (!alive()) return;

      const rec = recordings.find((r) => r.id === target);
      const nextOrientation = rec?.orientation ?? "portrait";

      if (!shownIdRef.current) {
        setCapReached(false);
        setPlaying(false);
        setShownId(target);
        setOrientation(nextOrientation);
        setSrc(url);
        setFade("out");
        await afterPaint();
        if (!alive()) return;
        setFade("in");
        onExtendedChange?.(true);
        return;
      }

      if (shownIdRef.current !== target) {
        setFade("out");
        await sleep(FILM_FADE_MS);
        if (!alive()) return;
        setCapReached(false);
        setPlaying(false);
        setShownId(target);
        setOrientation(nextOrientation);
        setSrc(url);
        await afterPaint();
        if (!alive()) return;
        setFade("in");
        return;
      }
    })();

    return () => {
      seqRef.current++;
    };
  }, [target, recordings, onExtendedChange]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const pauseAtStart = () => {
      v.pause();
      setPlaying(false);
    };
    v.addEventListener("loadeddata", pauseAtStart);
    if (v.readyState >= 2) pauseAtStart();
    return () => v.removeEventListener("loadeddata", pauseAtStart);
  }, [src, shownId]);

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        videoRef.current?.pause();
        setPlaying(false);
      }
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
    void v.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  function startPlayback() {
    const v = videoRef.current;
    if (!v) return;
    void v.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  const showPlayOverlay = Boolean(src && fade === "in" && !playing && !capReached);

  return (
    <div
      className={`film ${shown ? "mounted" : ""} ${
        orientation === "landscape" ? "film--landscape" : "film--portrait"
      }`}
      aria-hidden={!shown || fade === "out"}
    >
      {shown && src && (
        <div className={`film-inner film-fade film-fade--${fade}`}>
          <div className="film-clip">
            <video
              key={shown.id}
              ref={videoRef}
              className="film-player"
              src={src}
              controls
              playsInline
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={enforcePreviewCap}
              onSeeking={enforcePreviewCap}
              onError={() =>
                setErr(
                  "Could not load this recording. Rebuild the app if playback recently broke — the release CSP must allow https://nsmedia.localhost."
                )
              }
              style={{ aspectRatio: orientation === "portrait" ? "9 / 16" : "16 / 9" }}
            />
            {showPlayOverlay && (
              <button
                type="button"
                className="film-play-overlay"
                onClick={startPlayback}
                aria-label="Play recording"
              >
                <span className="film-play-ring">
                  <PlayIcon size={28} />
                </span>
              </button>
            )}
          </div>

          {!isPro && capReached && (
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
});
