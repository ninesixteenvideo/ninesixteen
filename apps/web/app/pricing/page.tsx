import { permanentRedirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Pricing — $49 one-time Pro license",
  description:
    "ninesixteen.video Pro is $49 USD one-time — no subscription. Record and preview free; unlock unlimited MP4 export to disk or Google Drive.",
  path: "/pricing",
  keywords: ["ninesixteen pricing", "screen recorder one time purchase", "pro license"],
});

export default function PricingPage() {
  permanentRedirect("/?view=pricing");
}
