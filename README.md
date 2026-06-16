# ninesixteen.video

> Record &amp; stream your desktop — framed by hand.

`ninesixteen.video` is a lightweight desktop recorder & live streamer for content
creators. Capture in **16×9** (widescreen) or **9×16** (vertical) and use your
**non-dominant hand** (a second mouse / input device) to pan, zoom and rotate the
framing viewport on the fly — buttery smooth.

This monorepo contains both halves of the product:

```
ninesixteen/
├── apps/
│   ├── web/          → Marketing site + auth + Stripe (Next.js 15, Tailwind v4)
│   └── desktop/      → The Tauri 2 desktop app
│       ├── src/      →   React + Vite frontend (studio UI, viewport preview)
│       └── src-tauri/→   Rust backend (capture, encode, raw-input, storage)
├── packages/
│   └── brand/        → Shared retro design tokens + the ninesixteen wordmark
└── scripts/          → Tooling (icon generation, etc.)
```

## The brand

Retro-inspired, **light mode only**. Display font is **Righteous**; body is
**Space Grotesk**; mono is **Space Mono**. The wordmark splits into three
syllables — `nine` (white, outlined), `six` (neon/pastel blue), `teen` (neon/pastel
pink) — on a warm light-grey background. All tokens live in
[`packages/brand`](packages/brand/src/tokens.ts) and are shared by both apps.

---

## Prerequisites

- **Node** ≥ 20 and **pnpm** 9 (`npm i -g pnpm`)
- **Rust** (stable, MSVC toolchain) + **Visual Studio Build Tools 2022** (Desktop C++)
- **WebView2 runtime** (preinstalled on Windows 11)

Install everything:

```bash
pnpm install
```

---

## Web app (landing / auth / billing)

```bash
pnpm web:dev      # http://localhost:3000
pnpm web:build    # production build
```

- **Runs out of the box with no config** — Firebase auth and Stripe checkout fall
  back to a local **demo mode** so the full flow is clickable while testing.
- To go live, copy `apps/web/.env.example` → `apps/web/.env.local` and fill in your
  Firebase + Stripe keys. (Stripe is a placeholder; no real charges until keys are set.)

Pages: landing (with a live, draggable viewport demo), `/pricing`, `/download`,
`/sign-in`, `/sign-up`, `/dashboard`, plus `/api/stripe/checkout` and
`/api/stripe/webhook` routes.

---

## Desktop app

```bash
pnpm desktop:web    # run just the UI in a browser (mock backend) — fast iteration
pnpm desktop:dev    # run the real Tauri app (native capture + raw input)
pnpm desktop:build  # produce an installer (.msi / .nsis)
```

The installer lands in `apps/desktop/src-tauri/target/release/bundle/`.

**Releasing updates:** see [UPDATEGUIDE.md](./UPDATEGUIDE.md) for signing keys, GitHub Actions, and auto-update.

### How the two-handed framing works

| Control            | Action                                   |
| ------------------ | ---------------------------------------- |
| Second mouse move  | Pan the framing viewport                 |
| Scroll wheel       | Zoom the viewport in / out               |
| Side button / `R`  | Rotate orientation 9×16 ⇄ 16×9           |
| Drag in preview    | Pan (mouse fallback)                     |

Bind your second device in **Settings → Control device**. Its motion is read via
the Windows **Raw Input** API and drives only the framing viewport.

### Architecture (Rust backend)

- **`capture.rs`** — Windows Graphics Capture of the primary monitor. Each frame is
  cropped + scaled to the active 16×9 / 9×16 canvas and fed to a hardware **H.264
  MP4 encoder** (`windows-capture`).
- **`rawinput.rs`** — a hidden message-only window registers for raw mouse input
  (`RIDEV_INPUTSINK`) and translates the bound device's deltas into pan/zoom/rotate.
- **`geometry.rs`** — viewport → crop-rect math + the nearest-neighbour scaler.
- **`screenshot.rs`** — GDI snapshot used as the live preview backdrop.
- **`recordings.rs`** — local-first storage in `Videos/ninesixteen/` with JSON sidecars.

### Honest notes / roadmap

- **Cursor suppression:** Windows can't hide the OS cursor for a *single* device via
  Raw Input alone (needs a filter driver). v1 reads the second mouse's deltas to
  drive the frame; the cursor may still drift, which is harmless while framing.
  A bundled interception driver is on the roadmap for true separation.
- **Orientation while recording:** the output canvas is fixed when a recording
  starts; flips during a take are reflected in the preview. Pan & zoom are fully
  live during recording.
- **Live streaming (RTMP):** GPU crop/scale → FFmpeg hardware H.264 → native RTMP
  publisher (Twitch, YouTube Live, etc.). Requires FFmpeg on PATH.
- **macOS/Linux:** the app is structured to extend; capture/raw-input are currently
  Windows-only.

---

## Scripts

| Command              | What it does                          |
| -------------------- | ------------------------------------- |
| `pnpm web:dev`       | Next.js dev server                    |
| `pnpm web:build`     | Build the web app                     |
| `pnpm desktop:web`   | Desktop UI in the browser (mock)      |
| `pnpm desktop:dev`   | Full Tauri dev app                    |
| `pnpm desktop:build` | Build the desktop installer           |
| `node scripts/gen-icon.mjs` | Regenerate the app icon source |
