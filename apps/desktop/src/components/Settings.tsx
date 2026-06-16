import { useState, useEffect } from "react";
import { useStore } from "../state/store";
import { isDesktop } from "../lib/bridge";
import { WEB_URL } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { submitFeedback } from "../lib/feedback";

async function openLegalPage(path: "/terms" | "/privacy") {
  const url = `${WEB_URL}${path}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function Settings() {
  const {
    inputSettings,
    monitors,
    monitor,
    setInputSettings,
  } = useStore();
  const { user } = useAuth();
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState(user?.email ?? "");
  const [sendLogs, setSendLogs] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      setFeedbackEmail((prev) => (prev.trim() ? prev : user.email));
    }
  }, [user?.email]);

  const handleSendFeedback = async () => {
    setFeedbackBusy(true);
    setFeedbackStatus(null);
    setFeedbackError(null);
    try {
      await submitFeedback(feedbackMessage, feedbackEmail || undefined, sendLogs);
      setFeedbackMessage("");
      setFeedbackStatus("Thanks — your feedback was sent.");
    } catch (e) {
      setFeedbackError(String(e));
    } finally {
      setFeedbackBusy(false);
    }
  };

  return (
    <div className="content scroll" style={{ maxWidth: 760, margin: "0 auto" }}>
      {!isDesktop && (
        <div className="banner" style={{ marginBottom: 16 }}>
          Web preview — capture runs only in the desktop build.
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Zoom</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Hold <span className="kbd">Alt</span> and scroll to zoom — or, on a laptop trackpad, hold{" "}
          <span className="kbd">Alt</span> and press <span className="kbd">↑</span> /{" "}
          <span className="kbd">↓</span>. Pauses briefly at full 9×16 so you can land there easily;
          zoom out further to see the whole desktop letterboxed.
        </p>
        <Slider
          label="Scroll sensitivity"
          value={inputSettings.zoomSensitivity}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => setInputSettings({ zoomSensitivity: v })}
        />
      </section>

      <section className="panel">
        <h3>Recording</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Recordings save as encrypted files you can preview in the app. Pro unlocks MP4 export.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="label">Source display</span>
          <span className="muted">
            {monitor?.name ?? monitors[0]?.name ?? "—"} ({monitor?.width}×{monitor?.height})
          </span>
        </div>
      </section>

      {isDesktop && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h3>Bug report &amp; feedback</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            Tell us what went wrong or what we could improve. Messages go to{" "}
            <a href="mailto:dev@ninesixteen.video">dev@ninesixteen.video</a>.
          </p>
          <div className="field" style={{ marginBottom: 12 }}>
            <span className="label">Your email (optional)</span>
            <input
              type="email"
              className="auth-input"
              placeholder="you@example.com"
              value={feedbackEmail}
              onChange={(e) => setFeedbackEmail(e.target.value)}
              disabled={feedbackBusy}
            />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <span className="label">Message</span>
            <textarea
              className="auth-input feedback-textarea"
              rows={5}
              placeholder="Describe the issue or share your feedback…"
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              disabled={feedbackBusy}
            />
          </div>
          <label className="feedback-check">
            <input
              type="checkbox"
              checked={sendLogs}
              onChange={(e) => setSendLogs(e.target.checked)}
              disabled={feedbackBusy}
            />
            <span>
              Send logs — includes technical diagnostics from this device (no recording
              content). Saved at{" "}
              <span className="kbd">Videos\ninesixteen\ninesixteen.log</span>.
            </span>
          </label>
          {feedbackError && <p className="auth-error" style={{ marginTop: 12 }}>{feedbackError}</p>}
          {feedbackStatus && (
            <p className="muted" style={{ marginTop: 12, color: "var(--ns-blue-deep)" }}>
              {feedbackStatus}
            </p>
          )}
          <button
            type="button"
            className="btn primary sm"
            style={{ marginTop: 14 }}
            disabled={feedbackBusy || feedbackMessage.trim().length < 10}
            onClick={() => void handleSendFeedback()}
          >
            {feedbackBusy ? "Sending…" : "Send feedback"}
          </button>
        </section>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <h3>Legal</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Terms of Use and Privacy Policy for {isDesktop ? "the desktop app and" : ""} the
          ninesixteen.video website. Contact{" "}
          <a href="mailto:dev@ninesixteen.video">dev@ninesixteen.video</a> with questions.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => openLegalPage("/terms")}>
            Terms of Use
          </button>
          <button className="btn ghost sm" onClick={() => openLegalPage("/privacy")}>
            Privacy Policy
          </button>
        </div>
      </section>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="row">
        <span className="label">{label}</span>
        <span className="muted">{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
