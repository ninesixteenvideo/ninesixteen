// Fetches the third-party Interception driver binaries used for Phase B
// "precision isolation" and drops them where the desktop app expects them.
//
//   node scripts/fetch-interception.mjs
//
// Places:
//   apps/desktop/src-tauri/resources/interception/install-interception.exe
//   apps/desktop/src-tauri/resources/interception/interception.dll  (x64)
// and copies interception.dll next to the dev build (target/debug, target/release)
// so runtime LoadLibrary can find it without a full bundle.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const tauriDir = join(repoRoot, "apps", "desktop", "src-tauri");
const resDir = join(tauriDir, "resources", "interception");

const URL =
  process.env.INTERCEPTION_URL ||
  "https://github.com/oblitum/Interception/releases/download/v1.0.1/Interception.zip";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

async function main() {
  mkdirSync(resDir, { recursive: true });
  const work = join(tmpdir(), `interception-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const zipPath = join(work, "Interception.zip");

  console.log(`↓ downloading ${URL}`);
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(zipPath, buf);
  console.log(`  saved ${(buf.length / 1e6).toFixed(1)} MB`);

  // `tar` ships with Windows 10+ (bsdtar) and can extract .zip archives.
  console.log("⇲ extracting…");
  execFileSync("tar", ["-xf", zipPath, "-C", work], { stdio: "inherit" });

  const files = walk(work);
  const installer = files.find((f) => /install-interception\.exe$/i.test(f));
  const dll = files.find((f) => /[\\/]x64[\\/]interception\.dll$/i.test(f)) ||
    files.find((f) => /interception\.dll$/i.test(f));

  if (!installer) throw new Error("install-interception.exe not found in archive");
  if (!dll) throw new Error("interception.dll (x64) not found in archive");

  copyFileSync(installer, join(resDir, "install-interception.exe"));
  copyFileSync(dll, join(resDir, "interception.dll"));
  console.log(`✓ bundled installer + dll → ${resDir}`);

  // Make the dll discoverable for `tauri dev` (loaded next to the exe).
  for (const profile of ["debug", "release"]) {
    const target = join(tauriDir, "target", profile);
    if (existsSync(target)) {
      copyFileSync(dll, join(target, "interception.dll"));
      console.log(`✓ copied dll → target/${profile}/`);
    }
  }

  console.log("\nDone. In the app: Settings → Precision isolation → Install driver, then reboot.");
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  console.error(`  Manual option: download ${URL}, then copy`);
  console.error(`  'command line installer/install-interception.exe' and 'library/x64/interception.dll'`);
  console.error(`  into ${resDir}`);
  process.exit(1);
});
