const CORAL = "#ff6b58";
const MINT = "#78ffd4";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  w: number;
  h: number;
  rotation: number;
  spin: number;
  life: number;
};

/** One-shot confetti burst from a screen-space origin (e.g. button center). */
export function confettiBurst(origin: { x: number; y: number }) {
  if (typeof document === "undefined") return;

  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  const drawCtx = ctx;

  const colors = [CORAL, MINT];
  const particles: Particle[] = Array.from({ length: 72 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 10 + 7;
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      w: Math.random() * 7 + 5,
      h: Math.random() * 4 + 3,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.35,
      life: 1,
    };
  });

  const durationMs = 1400;
  const start = performance.now();

  function frame(now: number) {
    const t = (now - start) / durationMs;
    if (t >= 1) {
      canvas.remove();
      return;
    }

    drawCtx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.vx *= 0.985;
      p.rotation += p.spin;
      p.life = 1 - t;

      drawCtx.save();
      drawCtx.translate(p.x, p.y);
      drawCtx.rotate(p.rotation);
      drawCtx.globalAlpha = Math.max(0, p.life);
      drawCtx.fillStyle = p.color;
      drawCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      drawCtx.restore();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
