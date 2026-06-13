export type Plan = "trial" | "pro";

export type UserEntitlementFields = {
  plan?: Plan;
  proEndsAt?: number | null;
  subscriptionCancelAtPeriodEnd?: boolean;
};

/** Parse Firestore users/{uid} entitlement fields. */
export function parseEntitlement(data: Record<string, unknown> | undefined): {
  plan: Plan;
  proEndsAt: number | null;
  subscriptionCancelAtPeriodEnd: boolean;
} {
  const plan: Plan = data?.plan === "pro" ? "pro" : "trial";
  const proEndsAt =
    typeof data?.proEndsAt === "number" && Number.isFinite(data.proEndsAt)
      ? data.proEndsAt
      : null;
  const subscriptionCancelAtPeriodEnd = data?.subscriptionCancelAtPeriodEnd === true;
  return { plan, proEndsAt, subscriptionCancelAtPeriodEnd };
}

/** Pro access is active until proEndsAt (if set) passes. */
export function isProEntitlement(
  fields: UserEntitlementFields,
  now = Date.now()
): boolean {
  const { plan, proEndsAt } = parseEntitlement(fields as Record<string, unknown>);
  if (plan !== "pro") return false;
  if (proEndsAt != null && proEndsAt <= now) return false;
  return true;
}

export function subscriptionCancelled(fields: UserEntitlementFields): boolean {
  const parsed = parseEntitlement(fields as Record<string, unknown>);
  return parsed.subscriptionCancelAtPeriodEnd && isProEntitlement(fields);
}

export function formatProEndDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(ms));
}
