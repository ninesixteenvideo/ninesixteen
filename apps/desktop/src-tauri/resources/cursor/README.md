# Cinematic cursor assets

## What to provide

Drop a **high-resolution PNG** here as `source.png`, then run:

```bash
cd apps/desktop/src-tauri
cargo run --example process_cursor -- resources/cursor/source.png
```

### `source.png` requirements

| Property | Requirement |
|----------|-------------|
| Format | **PNG with alpha** (RGBA) |
| Resolution | **512×512 px minimum** (1024×1024 ideal for 4K recordings) |
| Content | Pointer only, **no drop shadow** baked in (we draw a soft shadow at stamp time) |
| Outline | Crisp black stroke + white fill (or transparent fill we can infill with `--fill-infill`) |
| Padding | ~10% transparent margin around the pointer so scaling does not clip the tip |
| Background | Fully transparent |

### Optional: Icons8-style black-outline asset

If the PNG is a black-outline icon with a hollow interior:

```bash
cargo run --example process_cursor -- path/to/icon.png --fill-infill
```

## What the tool produces

- `default.png` — **256×256** master sprite (written here and to `apps/desktop/public/cursor/`)
- `cursor.json` — hotspot + dimensions for the live overlay

Do **not** hand-edit `default.png`. Always regenerate from `source.png`.

## Quality notes

Recordings stamp the 256×256 master with **Lanczos** scaling to the on-screen size (~36–112 px on 1080p). A sharp 512px+ source stays crisp after downscale. A 64px or upscaled asset will always look soft.
