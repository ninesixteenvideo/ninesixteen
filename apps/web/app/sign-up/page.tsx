import { permanentRedirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Create account",
  description: "Create your ninesixteen.video account to sync Pro across web and desktop.",
  path: "/sign-up",
  noIndex: true,
});

export default function SignUpPage() {
  permanentRedirect("/?view=sign-up");
}
