import { verifyUserIdToken } from "@/lib/firebaseAdmin";

export type AuthedUser = NonNullable<Awaited<ReturnType<typeof verifyUserIdToken>>>;

export async function requireBearerUser(
  req: Request
): Promise<AuthedUser | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyUserIdToken(header.slice("Bearer ".length));
}
