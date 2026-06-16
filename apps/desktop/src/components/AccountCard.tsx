import { useAuth } from "../lib/auth";
import { AuthPanel } from "./AuthPanel";

export function AccountCard() {
  const { user, isPro, loading, signOut, openCheckout } = useAuth();

  if (loading) return null;

  return (
    <section className="panel account-card" style={{ marginBottom: 16 }}>
      {!user ? (
        <>
          <h3>Sign in</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            Free to record &amp; preview. Sign in to sync your account and unlock export with Pro.
          </p>
          <AuthPanel />
        </>
      ) : (
        <>
          <h3>Account</h3>
          <div className="account-row">
            <div>
              <b>{user.displayName || user.email.split("@")[0]}</b>
              <div className="muted">{user.email}</div>
            </div>
            <span className={`plan-badge ${isPro ? "pro" : ""}`}>{isPro ? "Pro" : "Free"}</span>
          </div>

          {isPro && (
            <p className="muted" style={{ marginTop: 12 }}>
              Pro unlocked — lifetime license on this account.
            </p>
          )}

          {!isPro && (
            <button className="btn pink account-upgrade" onClick={() => openCheckout()}>
              Buy Pro · $49
            </button>
          )}

          <button className="btn account-signout" onClick={() => signOut()}>
            Sign out
          </button>

          {user.demo && (
            <p className="muted paywall-foot" style={{ marginTop: 12 }}>
              Demo session stored on this device. Configure Firebase to persist real accounts.
            </p>
          )}
        </>
      )}
    </section>
  );
}
