import type { Release } from "@/content/releases";

type ReleaseNotesListProps = {
  releases: readonly Release[];
  showLatestBadge?: boolean;
  compact?: boolean;
};

export function ReleaseNotesList({
  releases,
  showLatestBadge = true,
  compact = false,
}: ReleaseNotesListProps) {
  return (
    <div className="divide-y divide-line">
      {releases.map((release, index) => (
        <article
          key={release.version}
          className={compact ? "px-0 py-6" : "px-6 py-7 md:px-10"}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-display text-xl">v{release.version}</h3>
            {showLatestBadge && index === 0 ? (
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
  );
}
