import { useAuth } from "../lib/auth";
import { AuthPanel } from "./AuthPanel";

export function AccountCard() {
  const { user, isPro, loading, signOut, openCheckout } = useAuth();

  if (loading) return null;

  return (
    <section className="card">
      {!user ? (
        <>
          <h3 className="card-title">Sign in</h3>
          <p className="card-sub">
            Free to record &amp; preview. Sign in to sync your account and unlock export with Pro.
          </p>
          <AuthPanel />
        </>
      ) : (
        <>
          <h3 className="card-title">Account</h3>
          <div className="acct-row">
            <div>
              <div className="acct-name">{user.displayName || user.email.split("@")[0]}</div>
              <div className="acct-mail">{user.email}</div>
            </div>
            <span className={`acct-plan ${isPro ? "pro" : ""}`}>{isPro ? "Pro" : "Free"}</span>
          </div>

          {isPro && <p className="muted">Pro unlocked — lifetime license on this account.</p>}

          {!isPro && (
            <button className="btn primary block" onClick={() => openCheckout()}>
              Buy Pro · $49
            </button>
          )}

          <button className="btn block" style={{ marginTop: 10 }} onClick={() => signOut()}>
            Sign out
          </button>

          {user.demo && (
            <p className="muted" style={{ marginTop: 12 }}>
              Demo session stored on this device. Configure Firebase to persist real accounts.
            </p>
          )}
        </>
      )}
    </section>
  );
}
