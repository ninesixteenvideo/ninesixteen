import { useState } from "react";
import { useAuth } from "../lib/auth";
import { AuthPanel } from "./AuthPanel";

const PRO_FEATURES = [
  "Export & save unlimited videos",
  "No watermark",
  "1080p / 60fps encoding",
  "Priority builds & support",
];

export function Paywall({ onClose }: { onClose: () => void }) {
  const { user, openCheckout } = useAuth();
  const [interval, setInterval] = useState<"monthly" | "yearly">("yearly");
  const [opening, setOpening] = useState(false);

  const signedIn = Boolean(user);

  async function subscribe() {
    setOpening(true);
    try {
      await openCheckout(interval);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal paywall" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <span className="chip-pro">Pro</span>
        <h2 className="paywall-title">
          {signedIn ? "Unlock export" : "Create an account to export"}
        </h2>
        <p className="muted paywall-sub">
          Record and preview free, forever. Upgrade to Pro to export and save your
          videos without a watermark.
        </p>

        {!signedIn ? (
          <AuthPanel />
        ) : (
          <>
            <div className="price-toggle">
              {(["monthly", "yearly"] as const).map((opt) => (
                <button
                  key={opt}
                  className={`price-toggle-btn ${interval === opt ? "active" : ""}`}
                  onClick={() => setInterval(opt)}
                >
                  {opt === "monthly" ? "Monthly" : "Yearly"}
                  {opt === "yearly" && <span className="save-badge">save 73%</span>}
                </button>
              ))}
            </div>

            <div className="price-big">
              {interval === "monthly" ? (
                <>
                  <b>$12</b>
                  <span className="muted">/ month</span>
                </>
              ) : (
                <>
                  <b>$39</b>
                  <span className="muted">/ year</span>
                </>
              )}
            </div>

            <ul className="paywall-features">
              {PRO_FEATURES.map((f) => (
                <li key={f}>
                  <span className="tick">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <button className="btn pink paywall-cta" onClick={subscribe} disabled={opening}>
              {opening ? "Opening browser…" : "Subscribe in browser"}
            </button>
            <p className="muted paywall-foot">
              Checkout opens in your browser. Once you’re subscribed, export unlocks
              here automatically — no need to restart.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
