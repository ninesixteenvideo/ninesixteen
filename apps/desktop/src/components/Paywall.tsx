import { useState } from "react";
import { useAuth } from "../lib/auth";
import { AuthPanel } from "./AuthPanel";

const PRO_FEATURES = [
  "Export & save unlimited videos",
  "No watermark",
  "1080p / 60fps encoding",
  "Free updates & priority support",
];

export function Paywall({ onClose }: { onClose: () => void }) {
  const { user, openCheckout } = useAuth();
  const [opening, setOpening] = useState(false);

  const signedIn = Boolean(user);

  async function buy() {
    setOpening(true);
    try {
      await openCheckout();
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
          Record and preview free, forever. Buy Pro once to export and save your
          videos without a watermark — no subscription.
        </p>

        {!signedIn ? (
          <AuthPanel />
        ) : (
          <>
            <div className="price-big">
              <b>$49</b>
              <span className="muted">USD · one-time</span>
            </div>
            <p className="muted paywall-sub" style={{ marginTop: 4 }}>
              Lifetime license · pay once, no recurring fees
            </p>

            <ul className="paywall-features">
              {PRO_FEATURES.map((f) => (
                <li key={f}>
                  <span className="tick">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <button className="btn pink paywall-cta" onClick={buy} disabled={opening}>
              {opening ? "Opening browser…" : "Buy Pro in browser"}
            </button>
            <p className="muted paywall-foot">
              Checkout opens in your browser. Once your purchase completes, export
              unlocks here automatically — no need to restart.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
