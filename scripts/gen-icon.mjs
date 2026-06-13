// Generates the ninesixteen.video app icon source PNG (1024×1024) from an SVG.
// Run: node scripts/gen-icon.mjs  →  then `tauri icon` consumes the PNG.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const out = "apps/desktop/src-tauri/app-icon.png";

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="18" y="18" width="988" height="988" rx="210" fill="#ECEAE4" stroke="#17171B" stroke-width="36"/>
  <!-- 16x9 landscape frame (blue), behind -->
  <rect x="168" y="392" width="600" height="338" rx="30" fill="#3FC4F0" stroke="#17171B" stroke-width="30"/>
  <!-- 9x16 portrait frame (pink), in front -->
  <rect x="430" y="250" width="300" height="534" rx="30" fill="#FF7FC4" stroke="#17171B" stroke-width="30"/>
  <!-- record dot -->
  <circle cx="580" cy="517" r="40" fill="#FFFFFF" stroke="#17171B" stroke-width="22"/>
</svg>`;

mkdirSync(dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile(out);
console.log("wrote", out);
