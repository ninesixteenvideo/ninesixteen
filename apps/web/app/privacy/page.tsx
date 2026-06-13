import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { PRIVACY_SECTIONS } from "@/content/privacySections";
import { SERVICE_NAME } from "@/lib/legalMeta";

export const metadata: Metadata = {
  title: `Privacy Policy · ${SERVICE_NAME}`,
  description: `Privacy Policy for the ${SERVICE_NAME} website and Windows desktop app.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="How ninesixteen.video collects, uses, and protects information when you use our website, desktop app, accounts, and optional integrations."
      sections={PRIVACY_SECTIONS}
      sibling={{ href: "/terms", label: "Terms of Use" }}
    />
  );
}
