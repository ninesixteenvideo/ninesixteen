import { AuthForm } from "@/components/AuthForm";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Sign in",
  description: "Sign in to your ninesixteen.video account.",
  path: "/sign-in",
  noIndex: true,
});

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
