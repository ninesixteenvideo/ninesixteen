import { useStore } from "../state/store";
import { useAuth } from "../lib/auth";

export function AccountMenu() {
  const { user, isPro, loading } = useAuth();
  const setTab = useStore((s) => s.setTab);

  if (loading) return null;

  const label = user
    ? user.displayName?.split(" ")[0] || user.email.split("@")[0]
    : "Sign in";

  return (
    <button
      className={`pill account-pill ${user ? "" : "ghost"}`}
      onClick={() => setTab("settings")}
      title={user ? user.email : "Sign in"}
    >
      {user && <span className={`acct-dot ${isPro ? "pro" : ""}`} />}
      {label}
      {user && isPro && <span className="acct-pro">PRO</span>}
    </button>
  );
}
