"use client";

type HomeBackControlProps = {
  onBack: () => void;
  label?: string;
};

export function HomeBackControl({ onBack, label = "Back" }: HomeBackControlProps) {
  return (
    <button type="button" className="home-back" onClick={onBack}>
      <span className="home-back__glyph" aria-hidden>
        ←
      </span>
      {label}
    </button>
  );
}
