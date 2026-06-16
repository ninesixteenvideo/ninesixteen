import type { SVGProps } from "react";

/**
 * Minimal, monochrome line-icon set for the desktop UI.
 * Every icon draws with `currentColor` and a consistent 1.6 stroke so the
 * whole interface stays charcoal + white. Sized 24×24 by default; scale via
 * the `size` prop or font-size on the parent.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function ChevronLeft({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronRight({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Studio — a 9×16 viewfinder frame with a record dot. */
export function StudioIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="7" y="3.5" width="10" height="17" rx="2.4" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

/** Library — stacked clips with a play marker. */
export function LibraryIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="3.5" y="6.5" width="13" height="13" rx="2.2" />
      <path d="M8 4.5h9.5a2 2 0 0 1 2 2V16" opacity="0.5" />
      <path d="M8.6 10.6l4 2.4-4 2.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Settings — three adjuster sliders. */
export function SettingsIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function KeyboardIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8.5 14h7" />
    </svg>
  );
}

export function UserIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </svg>
  );
}

export function StopIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlayIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 6.5l10 5.5-10 5.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TrashIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 7h16M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
    </svg>
  );
}

export function ExportIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 3.5v10M8 7.5l4-4 4 4" />
      <path d="M5 14v3.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V14" />
    </svg>
  );
}

export function CloudIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 18a4 4 0 0 1-.6-7.96A5 5 0 0 1 16 9.5a3.5 3.5 0 0 1 .5 6.96" />
      <path d="M12 19v-7M9.5 14l2.5-2.5 2.5 2.5" />
    </svg>
  );
}

export function FolderIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 6.5a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6l1.2 1.2H18a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function CheckIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function MinimizeIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function CloseIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function HelpIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.2-2.6 3.9" />
      <circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LockIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}
