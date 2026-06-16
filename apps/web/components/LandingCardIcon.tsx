"use client";

import type { Icon } from "@phosphor-icons/react";

type LandingCardIconProps = {
  icon: Icon;
  tone?: "soft" | "ink";
  size?: number;
};

const TONE_CLASS = {
  soft: "text-inksoft",
  ink: "text-ink",
} as const;

/** Top-left card glyph — monochrome, matching desktop UI chrome. */
export function LandingCardIcon({
  icon: IconComponent,
  tone = "soft",
  size = 26,
}: LandingCardIconProps) {
  return (
    <IconComponent
      size={size}
      weight="bold"
      className={TONE_CLASS[tone]}
      aria-hidden
    />
  );
}
