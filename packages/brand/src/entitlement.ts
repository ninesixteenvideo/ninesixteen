export type Plan = "trial" | "pro";

export type UserEntitlementFields = {
  plan?: Plan;
};

/** Parse Firestore users/{uid} entitlement fields. */
export function parseEntitlement(data: Record<string, unknown> | undefined): {
  plan: Plan;
} {
  const plan: Plan = data?.plan === "pro" ? "pro" : "trial";
  return { plan };
}

/**
 * Pro is a one-time purchase (lifetime). Access is active whenever the stored
 * plan is "pro" — there is no expiry for a one-off license.
 */
export function isProEntitlement(fields: UserEntitlementFields): boolean {
  const { plan } = parseEntitlement(fields as Record<string, unknown>);
  return plan === "pro";
}
