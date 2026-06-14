/** Map low-level fetch / Firebase network errors to something actionable in the UI. */
export function friendlyAuthError(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  if (/failed to fetch|network-request-failed|network error/i.test(msg)) {
    return (
      "Could not reach the sign-in service. Check your internet connection. " +
      "If email sign-in keeps failing, ensure your Firebase API key allows " +
      "https://tauri.localhost in Google Cloud → Credentials → API key restrictions."
    );
  }
  return msg;
}
