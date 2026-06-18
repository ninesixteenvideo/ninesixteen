import { PricingPlans } from "@/components/PricingPlans";
import { JsonLd } from "@/components/JsonLd";
import { productJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Pricing — $49 one-time Pro license",
  description:
    "ninesixteen.video Pro is $49 USD one-time — no subscription. Record and preview free; unlock unlimited MP4 export to disk or Google Drive.",
  path: "/pricing",
  keywords: ["ninesixteen pricing", "screen recorder one time purchase", "pro license"],
});

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={[
          productJsonLd(),
          webPageJsonLd({
            title: "Pricing",
            description: "One-time Pro license for ninesixteen.video",
            path: "/pricing",
          }),
        ]}
      />
      <div className="mx-auto max-w-5xl px-5 pb-16 pt-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
            One price. Yours for good.
          </h1>
          <p className="mt-4 font-body text-lg text-inksoft">
            Pay once and own every export forever — no subscription, no renewals. The app is{" "}
            <b className="font-semibold text-ink">free to try</b>: download, record, and
            preview before you spend a cent.
          </p>
        </div>
        <PricingPlans />
      </div>
    </>
  );
}
