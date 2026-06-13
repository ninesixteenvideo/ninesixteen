// Downloads a Windows FFmpeg build and places it for the desktop app.
//
//   node scripts/fetch-ffmpeg.mjs
//
// Uses the BtbN essentials build (zip, no installer).

import { createWriteStream, existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const tauriDir = join(repoRoot, "apps", "desktop", "src-tauri");
const resDir = join(tauriDir, "resources", "ffmpeg");
const thirdParty = join(repoRoot, "third_party", "ffmpeg");

// Pin a specific BtbN release for production builds (override with FFMPEG_BUILD_URL).
const FFMPEG_URL =
  process.env.FFMPEG_BUILD_URL ??
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

async function download(url, dest) {
  console.log(`> downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function findFfmpegExe(dir) {
  for (const name of ["ffmpeg.exe", "bin/ffmpeg.exe"]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = findFfmpegExe(join(dir, entry.name));
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  mkdirSync(thirdParty, { recursive: true });
  const zip = join(thirdParty, "ffmpeg.zip");

  if (!existsSync(zip)) {
    await download(FFMPEG_URL, zip);
  }

  if (!existsSync(join(thirdParty, "ffmpeg.exe"))) {
    console.log("> extracting zip");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zip.replace(/'/g, "''")}' -DestinationPath '${thirdParty.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" }
    );
    const exe = findFfmpegExe(thirdParty);
    if (!exe) {
      console.error("ffmpeg.exe not found after extract");
      process.exit(1);
    }
    if (exe !== join(thirdParty, "ffmpeg.exe")) {
      copyFileSync(exe, join(thirdParty, "ffmpeg.exe"));
    }
  }

  mkdirSync(resDir, { recursive: true });
  copyFileSync(join(thirdParty, "ffmpeg.exe"), join(resDir, "ffmpeg.exe"));

  for (const sub of ["debug", "release"]) {
    const target = join(tauriDir, "target", sub);
    if (existsSync(target)) {
      const destDir = join(target, "resources", "ffmpeg");
      mkdirSync(destDir, { recursive: true });
      copyFileSync(join(thirdParty, "ffmpeg.exe"), join(destDir, "ffmpeg.exe"));
    }
  }

  console.log("ffmpeg.exe ready in resources/ffmpeg and target/{debug,release}/resources/ffmpeg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
