import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

const STATS_DOC = "stats/site";

export async function getDownloadCount(): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;
  const snap = await db.doc(STATS_DOC).get();
  const n = snap.data()?.downloads;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export async function incrementDownloadCount(): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;
  const ref = db.doc(STATS_DOC);
  await ref.set({ downloads: FieldValue.increment(1) }, { merge: true });
  const snap = await ref.get();
  const n = snap.data()?.downloads;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
