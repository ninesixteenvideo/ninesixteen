import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { isUserPro } from "@/lib/entitlementServer";
import { requireBearerUser } from "@/lib/requireAuth";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

/** Verify Firebase auth + active Pro entitlement (used by the desktop export commands). */
export async function GET(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin");
  if (blocked) return blocked;

  if (!isAdminConfigured) {
    return NextResponse.json({ pro: false, mock: true });
  }

  const user = await requireBearerUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pro = await isUserPro(user.uid);
  if (!pro) {
    return NextResponse.json({ pro: false }, { status: 403 });
  }

  return NextResponse.json({ pro: true });
}
