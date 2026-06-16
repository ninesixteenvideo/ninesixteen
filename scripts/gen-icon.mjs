// Rasterizes the ninesixteen.video app icon to a 1024×1024 PNG that `tauri icon`
// consumes. The single source of truth is icon-source.svg.
//
// Usage:
//   node scripts/gen-icon.mjs
//   cd apps/desktop && pnpm tauri icon src-tauri/app-icon.png
import sharp from "sharp";
import { readFileSync } from "node:fs";

const src = "apps/desktop/src-tauri/icons/icon-source.svg";
const out = "apps/desktop/src-tauri/app-icon.png";

const svg = readFileSync(src);
await sharp(svg).resize(1024, 1024).png().toFile(out);
console.log("wrote", out, "from", src);
