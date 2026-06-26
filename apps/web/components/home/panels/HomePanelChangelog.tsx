"use client";

import { RELEASES } from "@/content/releases";
import { ReleaseNotesList } from "@/components/ReleaseNotesList";
import { HomeBackControl } from "../HomeBackControl";

type HomePanelChangelogProps = {
  onBack: () => void;
  onDownload: () => void;
};

export function HomePanelChangelog({ onBack, onDownload }: HomePanelChangelogProps) {
  return (
    <section className="home-panel home-panel--wide" aria-label="Release notes">
      <HomeBackControl onBack={onBack} />
      <p className="home-panel__kicker">Desktop</p>
      <h2 className="home-panel__heading">Release notes</h2>
      <p className="home-panel__lede home-panel__lede--tight">
        What shipped in each build. The app checks for updates on launch.
      </p>

      <div className="home-panel__card home-panel__scroll">
        <ReleaseNotesList releases={RELEASES} compact />
      </div>

      <p className="home-panel__foot">
        <button type="button" className="home-panel__inline" onClick={onDownload}>
          Download latest build
        </button>
      </p>
    </section>
  );
}
