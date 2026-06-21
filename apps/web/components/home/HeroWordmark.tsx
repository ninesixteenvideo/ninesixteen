"use client";

import { WordmarkTv } from "@/components/WordmarkTv";

type HeroWordmarkProps = {
  compact?: boolean;
};

export function HeroWordmark({ compact = false }: HeroWordmarkProps) {
  const titleClass = [
    "home-hero__title",
    compact ? "home-hero__title--compact" : "home-hero__title--hero",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <h1 className={titleClass} aria-label="ninesixteen.video">
      <WordmarkTv
        size={compact ? 48 : 160}
        showSuffix
        wrapClassName="ns-wm-tv--hero"
        className="home-hero__wordmark"
      />
    </h1>
  );
}
