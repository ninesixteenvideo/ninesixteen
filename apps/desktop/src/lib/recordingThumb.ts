import { mediaSrc, isDesktop } from "./bridge";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Capture the first frame of a recording as a JPEG data URL (cached). */
export async function recordingThumb(id: string): Promise<string | null> {
  const hit = cache.get(id);
  if (hit) return hit;

  const pending = inflight.get(id);
  if (pending) return pending;

  const work = (async () => {
    if (!isDesktop) return null;
    const url = await mediaSrc(id);
    const data = await captureFirstFrame(url);
    if (data) cache.set(id, data);
    return data;
  })();

  inflight.set(id, work);
  try {
    return await work;
  } finally {
    inflight.delete(id);
  }
}

export function dropRecordingThumb(id: string) {
  cache.delete(id);
  inflight.delete(id);
}

function captureFirstFrame(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    let done = false;
    const finish = (data: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(data);
    };

    const timer = window.setTimeout(() => finish(null), 10_000);

    video.addEventListener("loadeddata", () => {
      video.currentTime = 0.04;
    });
    video.addEventListener("seeked", () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
          finish(null);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL("image/jpeg", 0.84));
      } catch {
        finish(null);
      }
    });
    video.addEventListener("error", () => finish(null));

    video.src = url;
  });
}
