import { permanentRedirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Changelog — desktop release notes",
  description:
    "Release notes for ninesixteen.video desktop: v1.2.3 recording stutter and game mode fixes, v1.2.2 capture hardening, v1.2.1 long-session stability, and earlier builds.",
  path: "/changelog",
  keywords: ["ninesixteen changelog", "ninesixteen release notes", "desktop app updates"],
});

export default function ChangelogPage() {
  permanentRedirect("/?view=changelog");
}
