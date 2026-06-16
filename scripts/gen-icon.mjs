// Rasterizes the ninesixteen.video app icon from icon-source.svg and refreshes
// every platform asset (desktop bundle, web favicon, apple touch icon).
//
// Usage:
//   node scripts/gen-icon.mjs
import sharp from "sharp";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "apps/desktop/src-tauri/icons/icon-source.svg");
const desktopPng = join(root, "apps/desktop/src-tauri/app-icon.png");
const webSvg = join(root, "apps/web/app/icon.svg");
const webApple = join(root, "apps/web/app/apple-icon.png");
const webFavicon = join(root, "apps/web/app/favicon.ico");
const desktopIco = join(root, "apps/desktop/src-tauri/icons/icon.ico");
const androidBg = join(
  root,
  "apps/desktop/src-tauri/icons/android/values/ic_launcher_background.xml"
);

const svg = readFileSync(src);

writeFileSync(webSvg, svg);
await sharp(svg).resize(1024, 1024).png().toFile(desktopPng);
await sharp(svg).resize(180, 180).png().toFile(webApple);

execSync("pnpm tauri icon src-tauri/app-icon.png", {
  cwd: join(root, "apps/desktop"),
  stdio: "inherit",
});

copyFileSync(desktopIco, webFavicon);

writeFileSync(
  androidBg,
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#1B1A18</color>
</resources>
`
);

console.log("Updated app icon assets from", src);
