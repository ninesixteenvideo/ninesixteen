import { PricingPlans } from "@/components/PricingPlans";

export const metadata = { title: "Pricing · ninesixteen.video" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <span className="ns-chip">Pricing</span>
        <h1 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">
          One price. Yours for good.
        </h1>
        <p className="mt-4 font-body text-lg text-inksoft">
          Pay once for decrypted MP4 export and free updates — no subscription. The
          app is <b className="font-semibold text-ink">free to try</b>: download, record,
          and preview without paying.
        </p>
      </div>
      <PricingPlans />
    </div>
  );
}
