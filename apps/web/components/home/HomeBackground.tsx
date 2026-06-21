"use client";

/** Soft mint/coral bloom behind the wordmark — nothing competing with the type. */
export function HomeBackground() {
  return (
    <div className="home-bg" aria-hidden>
      <div className="home-bg__glow home-bg__glow--mint" />
      <div className="home-bg__glow home-bg__glow--coral" />
      <div className="home-bg__vignette" />
    </div>
  );
}
