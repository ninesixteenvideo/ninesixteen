"use client";

import {
  Cursor,
  DeviceMobile,
  Export,
  Feather,
  FilmStrip,
  FrameCorners,
  GameController,
  GraduationCap,
  LockSimple,
  Record,
  RocketLaunch,
  Waveform,
} from "@phosphor-icons/react";
import { LandingCardIcon } from "@/components/LandingCardIcon";

const USE_CASES = [
  {
    icon: DeviceMobile,
    tone: "soft" as const,
    title: "Native short-form content",
    desc: "9×16 from frame one. Publish vertical clips in seconds with no post production reframing.",
  },
  {
    icon: RocketLaunch,
    tone: "ink" as const,
    title: "Demos & build-in-public",
    desc: "Show your app tight in portrait or widescreen — launch and progress clips for founders and indie hackers.",
  },
  {
    icon: GraduationCap,
    tone: "soft" as const,
    title: "Tutorials & courses",
    desc: "Keep the frame locked on the UI that matters while the viewport follows your cursor.",
  },
  {
    icon: GameController,
    tone: "ink" as const,
    title: "Walkthroughs & reviews",
    desc: "Capture software, tools, and gameplay in 9×16 or 16×9 with system audio and your voice.",
  },
];

const FEATURES = [
  {
    icon: FilmStrip,
    tone: "soft" as const,
    title: "True 9×16 & 16×9 capture",
    desc: "Pick portrait or landscape in Studio. What you frame is exactly what exports — zero letterboxing, zero cropping later.",
  },
  {
    icon: Cursor,
    tone: "ink" as const,
    title: "Cursor-driven framing",
    desc: "The frame follows your mouse. Hold Alt + scroll to glide from full desktop into a tight, intentional crop — live, as you record.",
  },
  {
    icon: Waveform,
    tone: "soft" as const,
    title: "System + mic audio",
    desc: "Blend desktop sound and your microphone with gain meters and a one-tap level check before you roll.",
  },
  {
    icon: Feather,
    tone: "ink" as const,
    title: "Native & featherlight",
    desc: "Built on Windows Graphics Capture, not a heavy Electron shell. Buttery capture, low CPU, no fan spin-up.",
  },
  {
    icon: Export,
    tone: "soft" as const,
    title: "Export-ready MP4",
    desc: "Unlock Pro to export clean MP4s to your disk or Google Drive — ready for CapCut, Premiere, or straight to upload.",
  },
  {
    icon: LockSimple,
    tone: "ink" as const,
    title: "Private & local-first",
    desc: "Recordings are encrypted on your own machine. Nothing leaves your disk until you choose to export.",
  },
];

const STEPS = [
  {
    icon: Record,
    tone: "ink" as const,
    title: "Hit Record",
    desc: "Press record in Studio. The app slips out of the way and drops a live 9×16 or 16×9 overlay onto your desktop.",
    points: ["Pick portrait or landscape before you roll", "5-second countdown so you can get set", "Cancel anytime before capture starts"],
  },
  {
    icon: FrameCorners,
    tone: "soft" as const,
    title: "Frame as you go",
    desc: "Steer the viewport with your cursor and zoom with Alt + scroll. Rule-of-thirds guides keep every shot composed.",
    points: ["Snap to full frame for precision", "Reframe live, mid-recording"],
  },
  {
    icon: Export,
    tone: "ink" as const,
    title: "Save & export",
    desc: "Stop and your clip saves encrypted, ready to preview in-app. Export to MP4 with Pro whenever you want.",
    points: ["Up to 1080p · 30 or 60 fps", "Drops straight into your editor"],
  },
];

export function UseCasesGrid() {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {USE_CASES.map((u) => (
        <div key={u.title} className="ns-card ns-card--flat p-5">
          <LandingCardIcon icon={u.icon} tone={u.tone} />
          <h3 className="mt-3 font-display text-lg">{u.title}</h3>
          <p className="mt-1.5 font-body text-sm text-inksoft">{u.desc}</p>
        </div>
      ))}
    </div>
  );
}

export function FeaturesGrid() {
  return (
    <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((f) => (
        <div key={f.title} className="ns-card p-6">
          <LandingCardIcon icon={f.icon} tone={f.tone} />
          <h3 className="mt-3 font-display text-xl">{f.title}</h3>
          <p className="mt-2 font-body text-sm leading-relaxed text-inksoft">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}

export function StepsGrid() {
  return (
    <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {STEPS.map((step) => (
        <div key={step.title} className="ns-card p-6">
          <LandingCardIcon icon={step.icon} tone={step.tone} />
          <h3 className="mt-3 font-display text-xl">{step.title}</h3>
          <p className="mt-2 font-body text-sm leading-relaxed text-inksoft">{step.desc}</p>
          {step.points.map((p) => (
            <p key={p} className="mt-2 font-body text-sm leading-relaxed text-inksoft">
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
