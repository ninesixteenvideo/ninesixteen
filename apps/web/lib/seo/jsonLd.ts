import type { FaqItem } from "@/content/faq";
import { LATEST_VERSION } from "@/content/releases";
import { getSiteUrl, PRODUCT_FEATURES, SITE } from "@/lib/site";

type JsonLd = Record<string, unknown>;

export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: getSiteUrl(),
    email: SITE.contactEmail,
    description: SITE.shortDescription,
    areaServed: "Worldwide",
    foundingLocation: SITE.operatorLocation,
  };
}

export function webSiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: getSiteUrl(),
    description: SITE.description,
    publisher: { "@type": "Organization", name: SITE.name },
  };
}

export function softwareApplicationJsonLd(): JsonLd {
  const version =
    process.env.NEXT_PUBLIC_DESKTOP_VERSION?.trim() || LATEST_VERSION;

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "MultimediaApplication",
    operatingSystem: SITE.platforms.join(", "),
    description: SITE.shortDescription,
    url: `${getSiteUrl()}/download`,
    downloadUrl: `${getSiteUrl()}/download`,
    softwareVersion: version,
    featureList: [...PRODUCT_FEATURES],
    offers: {
      "@type": "Offer",
      price: String(SITE.priceUsd),
      priceCurrency: SITE.currency,
      availability: "https://schema.org/InStock",
      url: `${getSiteUrl()}/pricing`,
      description: "One-time Pro license for unlimited MP4 exports",
    },
    publisher: { "@type": "Organization", name: SITE.operatorName },
  };
}

export function productJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${SITE.name} Pro`,
    description:
      "One-time license to export unlimited MP4 recordings from the ninesixteen.video Windows desktop app.",
    brand: { "@type": "Brand", name: SITE.name },
    offers: {
      "@type": "Offer",
      price: String(SITE.priceUsd),
      priceCurrency: SITE.currency,
      availability: "https://schema.org/InStock",
      url: `${getSiteUrl()}/pricing`,
      priceValidUntil: "2099-12-31",
    },
  };
}

export function faqPageJsonLd(items: readonly FaqItem[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function breadcrumbJsonLd(
  crumbs: readonly { name: string; path: string }[]
): JsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.path === "/" ? siteUrl : `${siteUrl}${crumb.path}`,
    })),
  };
}

export function webPageJsonLd(input: {
  title: string;
  description: string;
  path: string;
}): JsonLd {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.title,
    description: input.description,
    url: input.path === "/" ? siteUrl : `${siteUrl}${input.path}`,
    isPartOf: { "@type": "WebSite", name: SITE.name, url: siteUrl },
  };
}
