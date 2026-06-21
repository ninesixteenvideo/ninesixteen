export type LandingPageConfig = {
  slug: string;
  title: string;
  metaDescription: string;
  h1: string;
  kicker: string;
  intro: string;
  bullets: readonly string[];
  keywords: readonly string[];
  /** Short label for footer / index links */
  linkLabel?: string;
  category?: string;
};

/** Featured in footer “Use cases” — not duplicated under Solutions */
export const FEATURED_USE_CASE_SLUGS = [
  "tiktok-screen-recorder",
  "youtube-shorts-screen-recorder",
  "saas-demo-recorder",
] as const;

export function getLandingPageLinkLabel(page: LandingPageConfig): string {
  return page.linkLabel ?? page.kicker;
}
