"use client";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function scrollToReleaseNotes() {
  const target = document.getElementById("release-notes");
  if (!target) return;

  const headerOffset = 112; // matches scroll-mt-28 on the section
  const start = window.scrollY;
  const end = target.getBoundingClientRect().top + window.scrollY - headerOffset;
  const distance = end - start;
  const duration = Math.min(1600, Math.max(900, Math.abs(distance) * 0.55));
  let startTime: number | null = null;

  function step(now: number) {
    if (startTime === null) startTime = now;
    const progress = Math.min((now - startTime) / duration, 1);
    window.scrollTo(0, start + distance * easeInOutCubic(progress));
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

export function ReleaseNotesLink() {
  return (
    <p
      role="button"
      tabIndex={0}
      onClick={scrollToReleaseNotes}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          scrollToReleaseNotes();
        }
      }}
      className="ns-hero-caption absolute left-1/2 top-full mt-3 -translate-x-1/2 cursor-pointer"
    >
      release notes
    </p>
  );
}
