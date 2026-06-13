import type { Plan } from "@ninesixteen/brand";

const STORAGE_KEY = "ns_entitlement_v1";

export type PersistedEntitlement = {
  uid: string;
  plan: Plan;
  proEndsAt: number | null;
  subscriptionCancelAtPeriodEnd: boolean;
  updatedAt: number;
};

export function loadPersistedEntitlement(uid: string): PersistedEntitlement | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedEntitlement;
    if (data.uid !== uid) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePersistedEntitlement(data: PersistedEntitlement) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearPersistedEntitlement() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}
