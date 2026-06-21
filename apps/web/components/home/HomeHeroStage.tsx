"use client";

import { HomeCTAs } from "./HomeCTAs";
import type { HomeView } from "./homeViews";

type HomeHeroStageProps = {
  onNavigate: (view: HomeView) => void;
  disabled?: boolean;
  mirror?: boolean;
};

/** Tag line + control deck below the wordmark. */
export function HomeHeroStage({ onNavigate, disabled, mirror }: HomeHeroStageProps) {
  return (
    <>
      <p className="home-hero__tag">
        Native 9×16 &amp; 16×9 capture that follows your cursor — not just another screen recorder.
      </p>
      <HomeCTAs onNavigate={onNavigate} disabled={disabled || mirror} />
    </>
  );
}
