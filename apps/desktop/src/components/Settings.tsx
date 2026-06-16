import { useState, useEffect } from "react";
import { AccountCard } from "./AccountCard";
import { useStore } from "../state/store";
import { isDesktop } from "../lib/bridge";
import { WEB_URL } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { submitFeedback } from "../lib/feedback";
import {
  canAutoUpdate,
  checkForUpdates,
  installAvailableUpdate,
} from "../lib/updater";

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
    setInputSettings,
  } = useStore();
  const { user } = useAuth();
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState(user?.email ?? "");
  const [sendLogs, setSendLogs] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    if (user?.email) {
      setFeedbackEmail((prev) => (prev.trim() ? prev : user.email));
    }
  }, [user?.email]);

  const handleCheckForUpdates = async () => {
    setUpdateBusy(true);
    setUpdateStatus(null);
    setUpdateError(null);
    try {
      if (!canAutoUpdate()) {
        setUpdateStatus("Updates are checked automatically in release builds.");
        return;
      }
      const result = await checkForUpdates();
      if (result.status === "latest") {
        setUpdateStatus("You're on the latest version.");
        return;
      }
      if (result.status === "available") {
        setUpdateStatus(`Downloading v${result.version}…`);
        const install = await installAvailableUpdate();
        if (install.status === "error") {
          setUpdateError(install.message);
        }
        return;
      }
      if (result.status === "error") {
        setUpdateError(result.message);
        return;
      }
      setUpdateStatus("Auto-update is not available in this build.");
    } finally {
      setUpdateBusy(false);
    }
  };

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

      <AccountCard />

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Adjusters</h3>
        <Slider
          label="Scroll sensitivity"
          value={inputSettings.zoomSensitivity}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => setInputSettings({ zoomSensitivity: v })}
        />
      </section>

      {isDesktop && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h3>Updates</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            The app checks for updates on startup. You can also check manually here.
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="label">Current version</span>
            <span className="muted">{appVersion ?? "…"}</span>
          </div>
          {updateError && <p className="auth-error" style={{ marginBottom: 12 }}>{updateError}</p>}
          {updateStatus && (
            <p className="muted" style={{ marginBottom: 12, color: "var(--ns-blue-deep)" }}>
              {updateStatus}
            </p>
          )}
          <button
            type="button"
            className="btn ghost sm"
            disabled={updateBusy}
            onClick={() => void handleCheckForUpdates()}
          >
            {updateBusy ? "Checking…" : "Check for updates"}
          </button>
        </section>
      )}

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
