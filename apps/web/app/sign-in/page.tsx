import { permanentRedirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Sign in",
  description: "Sign in to your ninesixteen.video account.",
  path: "/sign-in",
  noIndex: true,
});

type SignInPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next } = await searchParams;
  if (next?.startsWith("/")) {
    permanentRedirect(`/?view=sign-in&next=${encodeURIComponent(next)}`);
  }
  permanentRedirect("/?view=sign-in");
}
