"use client";

import { HERO_HIGHLIGHTS } from "@/lib/site";
import { HomeCTAs } from "./HomeCTAs";
import type { HomeView } from "./homeViews";

type HomeHeroStageProps = {
  onNavigate: (view: HomeView) => void;
  disabled?: boolean;
};

/** Tag line + control deck below the wordmark. */
export function HomeHeroStage({ onNavigate, disabled }: HomeHeroStageProps) {
  return (
    <>
      <p className="home-hero__tag">
        Record your screen in true 9×16 or 16×9. Frame with your cursor — export without cropping
        in post.
      </p>
      <p className="home-hero__soon">{HERO_HIGHLIGHTS}</p>
      <HomeCTAs onNavigate={onNavigate} disabled={disabled} />
      <button
        type="button"
        className="home-hero__link"
        disabled={disabled}
        onClick={() => onNavigate("changelog")}
      >
        Release notes
      </button>
    </>
  );
}
