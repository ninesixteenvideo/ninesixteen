// Builds softcam.dll (virtual webcam) and places it for the desktop app.
//
//   node scripts/fetch-softcam.mjs
//
// Requires: Visual Studio Build Tools (MSBuild) with C++ workload.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const tauriDir = join(repoRoot, "apps", "desktop", "src-tauri");
const resDir = join(tauriDir, "resources", "softcam");
const thirdParty = join(repoRoot, "third_party", "softcam");
const dllSrc = join(thirdParty, "src", "softcam", "dist", "bin", "x64", "softcam.dll");

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

const CAMERA_NAME = "ninesixteen.video";

function applyBranding() {
  const files = [
    join(thirdParty, "src", "softcam", "softcam.cpp"),
    join(thirdParty, "src", "softcamcore", "DShowSoftcam.cpp"),
    join(thirdParty, "src", "softcamcore", "FrameBuffer.cpp"),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let text = readFileSync(file, "utf8");
    text = text
      .replaceAll("DirectShow Softcam Stream", `${CAMERA_NAME} Stream`)
      .replaceAll("DirectShow Softcam", CAMERA_NAME);
    writeFileSync(file, text, "utf8");
  }
  console.log(`Branded softcam as "${CAMERA_NAME}"`);
}

function findMsBuild() {
  const candidates = [
    process.env.MSBUILD,
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const out = execSync("where msbuild", { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (out && existsSync(out)) return out;
  } catch {}
  return null;
}

async function main() {
  if (!existsSync(thirdParty)) {
    mkdirSync(join(repoRoot, "third_party"), { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", "v1.8.1", "https://github.com/tshino/softcam.git", thirdParty]);
  }

  applyBranding();

  const msbuild = findMsBuild();
  if (!msbuild) {
    console.error("MSBuild not found. Install Visual Studio Build Tools (C++) and re-run.");
    process.exit(1);
  }
  const sln = join(thirdParty, "src", "softcam", "softcam.vcxproj");
  if (!existsSync(sln)) {
    console.error(`softcam.vcxproj not found at ${sln}`);
    process.exit(1);
  }
  run(msbuild, [sln, "/p:Configuration=Release", "/p:Platform=x64", "/m"]);

  if (!existsSync(dllSrc)) {
    console.error(`Expected DLL at ${dllSrc}`);
    process.exit(1);
  }

  mkdirSync(resDir, { recursive: true });
  copyFileSync(dllSrc, join(resDir, "softcam.dll"));

  for (const sub of ["debug", "release"]) {
    const target = join(tauriDir, "target", sub);
    if (existsSync(target)) {
      copyFileSync(dllSrc, join(target, "softcam.dll"));
      const resSoftcam = join(target, "resources", "softcam");
      mkdirSync(resSoftcam, { recursive: true });
      copyFileSync(dllSrc, join(resSoftcam, "softcam.dll"));
    }
  }

  console.log("softcam.dll ready in resources/softcam and target/{debug,release}");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
