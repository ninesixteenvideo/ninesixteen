import { permanentRedirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Changelog — desktop release notes",
  description:
    "Release notes for ninesixteen.video desktop: v1.2.0 Game mode and 4K landscape, v1.1.0 landscape and cinematic cursor, and earlier builds.",
  path: "/changelog",
  keywords: ["ninesixteen changelog", "ninesixteen release notes", "desktop app updates"],
});

export default function ChangelogPage() {
  permanentRedirect("/?view=changelog");
}
