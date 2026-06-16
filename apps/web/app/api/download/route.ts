import { NextResponse } from "next/server";
import { incrementDownloadCount } from "@/lib/siteStats";

export const runtime = "nodejs";

/** Count a site download, then redirect to the public installer URL. */
export async function GET() {
  const installerUrl = process.env.NEXT_PUBLIC_DESKTOP_INSTALLER_URL?.trim();
  if (!installerUrl) {
    return NextResponse.json({ error: "Installer URL not configured" }, { status: 503 });
  }

  try {
    await incrementDownloadCount();
  } catch (err) {
    console.error("[download] increment failed:", err);
  }

  return NextResponse.redirect(installerUrl, 302);
}
