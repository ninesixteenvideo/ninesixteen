import { isDesktop } from "./bridge";

export type UpdateCheckResult =
  | { status: "unavailable" }
  | { status: "latest" }
  | { status: "available"; version: string }
  | { status: "installed"; version: string }
  | { status: "error"; message: string };

/** True only for signed release builds (not `tauri dev` or browser preview). */
export function canAutoUpdate(): boolean {
  return isDesktop && import.meta.env.PROD;
}

/** Check GitHub Releases for a newer signed build. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!canAutoUpdate()) {
    return { status: "unavailable" };
  }

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      return { status: "latest" };
    }
    return { status: "available", version: update.version };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

/** Download, install, and restart into the new version. */
export async function installAvailableUpdate(): Promise<UpdateCheckResult> {
  if (!canAutoUpdate()) {
    return { status: "unavailable" };
  }

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      return { status: "latest" };
    }

    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return { status: "installed", version: update.version };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

/** Startup check — prompts only when a newer version exists. */
export async function checkForUpdatesOnStartup(): Promise<void> {
  if (!canAutoUpdate()) return;

  const result = await checkForUpdates();
  if (result.status !== "available") return;

  const { ask } = await import("@tauri-apps/plugin-dialog");
  const yes = await ask(
    `Version ${result.version} is available. Download and install now?`,
    { title: "Update available", kind: "info", okLabel: "Update now", cancelLabel: "Later" }
  );
  if (!yes) return;

  await installAvailableUpdate();
}
