import { useState } from "react";
import { useAuth } from "../lib/auth";
import { AuthPanel } from "./AuthPanel";
import { CheckIcon, CloseIcon } from "./icons";

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
    <div className="scrim" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>

        <span className="badge">Pro</span>
        <h2 className="dialog-title">
          {signedIn ? "Unlock export" : "Create an account to export"}
        </h2>
        <p className="dialog-sub">
          Record and preview free, forever. Buy Pro once to export and save your videos without a
          watermark — no subscription.
        </p>

        {!signedIn ? (
          <AuthPanel />
        ) : (
          <>
            <div className="price">
              <b>$49</b>
              <span className="muted">USD · one-time</span>
            </div>
            <p className="dialog-sub" style={{ marginTop: 4 }}>
              Lifetime license · pay once, no recurring fees
            </p>

            <ul className="feature-list">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="feature">
                  <span className="feature-tick">
                    <CheckIcon size={13} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <button className="btn primary block" style={{ marginTop: 20 }} onClick={buy} disabled={opening}>
              {opening ? "Opening browser…" : "Buy Pro in browser"}
            </button>
            <p className="dialog-sub" style={{ marginTop: 12 }}>
              Checkout opens in your browser. Once your purchase completes, export unlocks here
              automatically — no need to restart.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
