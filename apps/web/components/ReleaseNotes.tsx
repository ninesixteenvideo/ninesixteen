const RELEASES = [
  {
    version: "1.0.0",
    date: "June 2026",
    items: [
      "Complete desktop redesign — a slim collapsible dock with the vertical ninesixteen.video wordmark, icon tabs, and smooth expand/collapse animations",
      "Library film player slides out from behind the sidebar for a full 9\u00d716 preview beside your takes; first-frame thumbnails in the filmstrip",
      "Live status stage during capture — countdown, recording timer, and saving state stay visible while the dock stays out of the way",
      "Info & feedback tab — account, updates, feedback, and legal links in one place",
      "Refreshed app icon on the installer, taskbar, and window",
      "Window controls stay accessible when expanded — close quits the app, minimize hides to the tray",
      "Alt + \u2191 / \u2193 zoom in and out again (alongside Alt + scroll)",
    ],
  },
  {
    version: "0.1.2",
    date: "June 2026",
    items: [
      "Audio sync fixed for good across every audio device \u2014 interfaces and outputs that stay silent between sounds (e.g. Steinberg UR22) now stay perfectly in time",
      "Recordings are locked to the wall clock in real time instead of being stretched to fit afterwards",
    ],
  },
  {
    version: "0.1.1",
    date: "June 2026",
    items: [
      "Fixed audio sync when your default output isn\u2019t 48\u202fkHz (e.g. audio interfaces at 44.1\u202fkHz)",
      "New 96 app icon on the installer, taskbar, and window",
      "Update prompt modal on startup when a newer build is available",
      "Refreshed 5\u20134\u20133\u20132\u20131 countdown with brand colors",
      "Download page notes for unsigned Windows installs",
    ],
  },
  {
    version: "0.1.0",
    date: "June 2026",
    items: [
      "Initial release \u2014 true 9\u00d716 vertical capture with cursor framing",
      "Alt + scroll zoom, system & mic audio, encrypted local recordings",
      "Pro export ($49 one-time) shared with the web app",
      "In-app auto-update via GitHub Releases",
    ],
  },
] as const;

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
            .
          </p>
        </div>

        <div className="divide-y divide-line">
          {RELEASES.map((release, index) => (
            <article key={release.version} className="px-6 py-7 md:px-10">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-xl">v{release.version}</h3>
                {index === 0 ? (
                  <span className="rounded-full border border-linehi bg-surfacehi px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink">
                    Latest
                  </span>
                ) : null}
                <span className="font-mono text-xs text-inkfaint">{release.date}</span>
              </div>
              <ul className="mt-4 space-y-2.5">
                {release.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 font-body text-sm leading-relaxed text-inksoft"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-inkfaint" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
