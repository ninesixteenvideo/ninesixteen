const RELEASES = [
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
        <div className="border-b-2 border-linesoft px-6 py-8 md:px-10">
          <span className="ns-chip">Changelog</span>
          <h2 className="mt-4 font-display text-3xl tracking-tight sm:text-4xl">
            Release notes
          </h2>
          <p className="mt-3 max-w-xl font-body text-sm text-inksoft">
            What shipped in each desktop build. The app checks for updates on launch
            — or grab the latest from{" "}
            <a href="/download" className="font-semibold text-bluedeep hover:underline">
              Download
            </a>
            .
          </p>
        </div>

        <div className="divide-y-2 divide-linesoft">
          {RELEASES.map((release, index) => (
            <article key={release.version} className="px-6 py-7 md:px-10">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-xl">v{release.version}</h3>
                {index === 0 ? (
                  <span className="rounded-full border border-blue bg-blue/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blue">
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
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pink" />
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
