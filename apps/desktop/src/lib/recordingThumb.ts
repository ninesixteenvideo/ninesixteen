import { thumbSrc, isDesktop } from "./bridge";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

/** Cached thumbnail URL (`nsthumb://`) for library rows. */
export async function recordingThumb(id: string): Promise<string | null> {
  const hit = cache.get(id);
  if (hit) return hit;

  const pending = inflight.get(id);
  if (pending) return pending;

  const work = schedule(async () => {
    if (!isDesktop) return null;
    const url = await thumbSrc(id);
    if (url) cache.set(id, url);
    return url;
  });

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

/** Warm thumbnails for a small set of visible ids (IntersectionObserver in RecThumb). */
export function prefetchRecordingThumbs(ids: string[]): void {
  for (const id of ids.slice(0, 6)) {
    void recordingThumb(id).catch(() => {});
  }
}
