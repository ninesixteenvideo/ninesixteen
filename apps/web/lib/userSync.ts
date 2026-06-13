import type { User } from "firebase/auth";

/** Tell the server to create/update users/{uid} after sign-in. Best-effort. */
export async function syncUserProfile(fbUser: User): Promise<void> {
  try {
    const token = await fbUser.getIdToken();
    await fetch("/api/users/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: fbUser.email,
        displayName: fbUser.displayName,
      }),
    });
  } catch {
    // Non-fatal — client still defaults to free until Firestore catches up.
  }
}
