import { RELEASES } from "@/content/releases";
import { ReleaseNotesList } from "@/components/ReleaseNotesList";

export function ReleaseNotesSection() {
  return (
    <section id="release-notes" className="scroll-mt-28 py-16 pb-24">
      <div className="ns-card ns-card--flat overflow-hidden">
        <div className="border-b border-line px-6 py-8 md:px-10">
          <span className="ns-chip">Changelog</span>
          <h2 className="mt-4 font-display text-3xl tracking-tight sm:text-4xl">
            Release notes
          </h2>
          <p className="mt-3 max-w-xl font-body text-sm text-inksoft">
            What shipped in each desktop build. The app checks for updates on launch
            — or grab the latest from{" "}
            <a href="/download" className="ns-link">
              Download
            </a>
            .{" "}
            <a href="/changelog" className="ns-link">
              Full changelog →
            </a>
          </p>
        </div>
        <ReleaseNotesList releases={RELEASES} />
      </div>
    </section>
  );
}
