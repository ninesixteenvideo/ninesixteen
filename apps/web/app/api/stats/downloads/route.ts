import { NextResponse } from "next/server";
import { getDownloadCount } from "@/lib/siteStats";

export const runtime = "nodejs";

export async function GET() {
  try {
    const downloads = await getDownloadCount();
    return NextResponse.json({ downloads });
  } catch (err) {
    console.error("[stats/downloads]", err);
    return NextResponse.json({ downloads: 0 });
  }
}
