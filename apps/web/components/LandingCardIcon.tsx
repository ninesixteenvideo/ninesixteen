"use client";

import type { Icon } from "@phosphor-icons/react";

type LandingCardIconProps = {
  icon: Icon;
  /** Mint by default — matches brand accent on dark cards. */
  tone?: "mint" | "coral" | "ink";
  size?: number;
};

const TONE_CLASS = {
  mint: "text-blue",
  coral: "text-pink",
  ink: "text-inksoft",
} as const;

/** Top-left card glyph — bold Phosphor, no box or border. */
export function LandingCardIcon({
  icon: IconComponent,
  tone = "mint",
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
