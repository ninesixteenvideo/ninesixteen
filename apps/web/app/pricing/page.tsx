import { PricingPlans } from "@/components/PricingPlans";

export const metadata = { title: "Pricing · ninesixteen.video" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <span className="ns-chip">Pricing</span>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl">Simple, creator-friendly.</h1>
        <p className="mt-4 font-body text-inksoft">
          Free and unlimited during the beta. Upgrade to Pro when you’re ready for
          streaming, longer recordings and priority builds.
        </p>
      </div>
      <PricingPlans />
    </div>
  );
}
