"use client";

import {
  Cursor,
  DeviceMobile,
  Export,
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
    title: "Short-form vertical",
    desc: "Record true 9×16 for TikTok, Reels, and YouTube Shorts. No crop step in your editor.",
  },
  {
    icon: RocketLaunch,
    tone: "ink" as const,
    title: "Product demos",
    desc: "16×9 or 9×16 walkthroughs with cursor-driven framing — keep the UI you point at in shot.",
  },
  {
    icon: GraduationCap,
    tone: "soft" as const,
    title: "Tutorials & courses",
    desc: "Follow your cursor through steps. Alt + scroll zoom for detail when you need it.",
  },
  {
    icon: GameController,
    tone: "ink" as const,
    title: "Gameplay & reviews",
    desc: "Game mode locks the full frame — Crosshair or horizontal pan in portrait, system cursor in the export.",
  },
];

const FEATURES = [
  {
    icon: FilmStrip,
    tone: "soft" as const,
    title: "True 9×16 & 16×9 capture",
    desc: "Pick portrait or landscape in Studio. The overlay, library player, and MP4 export share the same aspect.",
  },
  {
    icon: Cursor,
    tone: "ink" as const,
    title: "Cursor-driven framing",
    desc: "The viewport follows your mouse. Alt + scroll zooms from full desktop into a tight crop while you record.",
  },
  {
    icon: GameController,
    tone: "soft" as const,
    title: "Game mode",
    desc: "Lock the full frame with zoom off. Portrait Crosshair keeps the view centered; Cursor pans horizontally only.",
  },
  {
    icon: Waveform,
    tone: "ink" as const,
    title: "System + mic audio",
    desc: "Record desktop sound and your microphone together, with level meters before you roll.",
  },
  {
    icon: Export,
    tone: "soft" as const,
    title: "Up to 4K Pro export",
    desc: "Landscape through 4K @ 60 fps. Portrait up to 1080p. Hardware-aware settings in Studio.",
  },
  {
    icon: LockSimple,
    tone: "ink" as const,
    title: "Local & encrypted",
    desc: "Recordings stay on your machine until you export with Pro. Preview everything in the built-in library.",
  },
];

const STEPS = [
  {
    icon: Record,
    tone: "ink" as const,
    title: "Record",
    desc: "Choose 9×16 or 16×9 in Studio, enable Game mode if you want a locked frame, then start capture.",
    points: ["5-second countdown before capture begins", "Cancel anytime during the countdown"],
  },
  {
    icon: FrameCorners,
    tone: "soft" as const,
    title: "Frame live",
    desc: "Steer with your cursor and zoom with Alt + scroll. Rule-of-thirds guides help you compose mid-take.",
    points: ["Alt+F to unfreeze and re-aim", "Game mode disables zoom for fixed captures"],
  },
  {
    icon: Export,
    tone: "ink" as const,
    title: "Export",
    desc: "Stop to save an encrypted take in your library. Pro unlocks MP4 export to disk or Google Drive.",
    points: ["720p–4K landscape · 1080p portrait", "Adaptive H.264 for your GPU"],
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
