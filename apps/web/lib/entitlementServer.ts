import { isProEntitlement, parseEntitlement } from "@ninesixteen/brand";
import { getAdminDb } from "@/lib/firebaseAdmin";

/** Server-side Pro check from Firestore users/{uid}. */
export async function isUserPro(uid: string): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !uid) return false;
  const snap = await db.collection("users").doc(uid).get();
  return isProEntitlement(parseEntitlement(snap.data()));
}
