import Link from "next/link";
import { RELEASES } from "@/content/releases";
import { ReleaseNotesList } from "@/components/ReleaseNotesList";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Changelog — desktop release notes",
  description:
    "Release notes for ninesixteen.video desktop: v1.1.0 adds 16×9 landscape, cinematic cursor, click audio, faster Library, and more.",
  path: "/changelog",
  keywords: ["ninesixteen changelog", "ninesixteen release notes", "desktop app updates"],
});

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-10">
      <JsonLd
        data={[
          webPageJsonLd({
            title: "Changelog",
            description: "Desktop release notes for ninesixteen.video",
            path: "/changelog",
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Changelog", path: "/changelog" },
          ]),
        ]}
      />
      <nav className="font-mono text-xs text-inkfaint">
        <Link href="/" className="hover:text-inksoft">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-inksoft">Changelog</span>
      </nav>

      <div className="ns-card ns-card--flat mt-8 overflow-hidden">
        <div className="border-b border-line px-6 py-8 md:px-10">
          <span className="ns-chip">Changelog</span>
          <h1 className="mt-4 font-display text-4xl tracking-tight">Release notes</h1>
          <p className="mt-3 max-w-xl font-body text-sm text-inksoft">
            What shipped in each desktop build. The app checks for updates on launch.
          </p>
        </div>
        <ReleaseNotesList releases={RELEASES} />
      </div>

      <div className="mt-10">
        <Link href="/download" className="ns-cta ns-cta--primary">
          Download latest build
        </Link>
      </div>
    </div>
  );
}
