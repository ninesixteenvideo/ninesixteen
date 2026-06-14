import { useState } from "react";
import { useAuth } from "../lib/auth";
import { AuthPanel } from "./AuthPanel";

export function AccountMenu() {
  const { user, isPro, loading, signOut, openCheckout } = useAuth();
  const [open, setOpen] = useState(false);

  if (loading) return null;

  const label = user
    ? user.displayName?.split(" ")[0] || user.email.split("@")[0]
    : "Sign in";

  return (
    <>
      <button
        className={`pill account-pill ${user ? "" : "ghost"}`}
        onClick={() => setOpen(true)}
        title={user ? user.email : "Sign in"}
      >
        {user && <span className={`acct-dot ${isPro ? "pro" : ""}`} />}
        {label}
        {user && isPro && <span className="acct-pro">PRO</span>}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal account-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>

            {!user ? (
              <>
                <h2 className="paywall-title">Sign in to ninesixteen</h2>
                <p className="muted paywall-sub">
                  Free to record &amp; preview. Sign in to sync your account and unlock
                  export with Pro.
                </p>
                <AuthPanel onDone={() => setOpen(false)} />
              </>
            ) : (
              <>
                <h2 className="paywall-title">Account</h2>
                <div className="account-row">
                  <div>
                    <b>{user.displayName || user.email.split("@")[0]}</b>
                    <div className="muted">{user.email}</div>
                  </div>
                  <span className={`plan-badge ${isPro ? "pro" : ""}`}>
                    {isPro ? "Pro" : "Free"}
                  </span>
                </div>

                {isPro && (
                  <p className="muted paywall-sub" style={{ marginTop: 12 }}>
                    Pro unlocked — lifetime license on this account.
                  </p>
                )}

                {!isPro && (
                  <button
                    className="btn pink account-upgrade"
                    onClick={() => openCheckout()}
                  >
                    Buy Pro · $49
                  </button>
                )}

                <button className="btn account-signout" onClick={() => signOut()}>
                  Sign out
                </button>

                {user.demo && (
                  <p className="muted paywall-foot">
                    Demo session stored on this device. Configure Firebase to persist real
                    accounts.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
