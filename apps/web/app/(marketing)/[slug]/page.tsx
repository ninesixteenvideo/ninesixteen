import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LANDING_PAGES } from "@/content/landingPages";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { SeoLandingPage } from "@/components/SeoLandingPage";

type PageProps = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return LANDING_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = LANDING_PAGES.find((entry) => entry.slug === slug);
  if (!page) return {};

  return buildPageMetadata({
    title: page.title,
    description: page.metaDescription,
    path: `/${page.slug}`,
    keywords: page.keywords,
  });
}

export default async function MarketingLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const page = LANDING_PAGES.find((entry) => entry.slug === slug);
  if (!page) notFound();
  return <SeoLandingPage page={page} />;
}
