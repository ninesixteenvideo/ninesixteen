import { createHash, timingSafeEqual } from "crypto";

export function hashHandoffSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function secretsMatch(storedHash: string, secret: string): boolean {
  const expected = Buffer.from(hashHandoffSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (expected.length !== stored.length) return false;
  return timingSafeEqual(expected, stored);
}
