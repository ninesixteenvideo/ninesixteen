import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { TERMS_SECTIONS } from "@/content/termsSections";
import { SERVICE_NAME } from "@/lib/legalMeta";

export const metadata: Metadata = {
  title: `Terms of Use · ${SERVICE_NAME}`,
  description: `Terms of Use for the ${SERVICE_NAME} website and Windows desktop app.`,
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      summary="These terms govern your use of the ninesixteen.video website, Windows desktop app, one-time Pro purchase, and related services."
      sections={TERMS_SECTIONS}
      sibling={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
