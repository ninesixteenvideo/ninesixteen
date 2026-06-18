import { useState, useEffect } from "react";
import { isDesktop } from "../lib/bridge";
import { WEB_URL } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { submitFeedback } from "../lib/feedback";
import { canAutoUpdate, checkForUpdates, installAvailableUpdate } from "../lib/updater";

async function openLegalPage(path: "/terms" | "/privacy") {
  const url = `${WEB_URL}${path}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

async function openWebsite(path = "") {
  const url = `${WEB_URL}${path}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function Info() {
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
        if (install.status === "error") setUpdateError(install.message);
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
    <div className="scroll pad">
      <div className="settings">
        {!isDesktop && (
          <div className="card">
            <p className="muted">Web preview — capture runs only in the desktop build.</p>
          </div>
        )}

        <section className="card">
          <h3 className="card-title">About</h3>
          <p className="card-sub">
            <strong>ninesixteen.video</strong> records your screen in native 9×16 portrait or
            16×9 landscape — no crop in post. Frame with your cursor, zoom with Alt + scroll,
            and export MP4 with Pro ($49 one-time).
          </p>
          <ul className="card-sub" style={{ marginTop: 10, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>True 9×16 and 16×9 capture from frame one</li>
            <li>System + mic audio, optional click sounds</li>
            <li>Encrypted local recordings · virtual camera for OBS/Zoom</li>
            <li>Free to record and preview</li>
          </ul>
          <div className="row" style={{ gap: 8, justifyContent: "flex-start", flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn ghost sm" onClick={() => void openWebsite()}>
              ninesixteen.video
            </button>
            <button className="btn ghost sm" onClick={() => void openWebsite("/download")}>
              Download page
            </button>
            <button className="btn ghost sm" onClick={() => void openWebsite("/faq")}>
              FAQ
            </button>
            <button className="btn ghost sm" onClick={() => void openWebsite("/changelog")}>
              Changelog
            </button>
          </div>
        </section>

        <section className="card">
          <h3 className="card-title">Bug report &amp; feedback</h3>
          <p className="card-sub">
            Tell us what went wrong or what we could improve. Messages go to{" "}
            <a href="mailto:dev@ninesixteen.video">dev@ninesixteen.video</a>.
          </p>
          <div className="field">
            <span className="label">Your email (optional)</span>
            <input
              type="email"
              className="input"
              placeholder="you@example.com"
              value={feedbackEmail}
              onChange={(e) => setFeedbackEmail(e.target.value)}
              disabled={feedbackBusy}
            />
          </div>
          <div className="field">
            <span className="label">Message</span>
            <textarea
              className="textarea"
              rows={5}
              placeholder="Describe the issue or share your feedback…"
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              disabled={feedbackBusy}
            />
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={sendLogs}
              onChange={(e) => setSendLogs(e.target.checked)}
              disabled={feedbackBusy}
            />
            <span>
              Send logs — includes technical diagnostics from this device (no recording content).
              Saved at <span className="kbd">Videos\ninesixteen\ninesixteen.log</span>.
            </span>
          </label>
          {feedbackError && <p className="auth-err" style={{ marginTop: 12 }}>{feedbackError}</p>}
          {feedbackStatus && <p className="note-ok" style={{ marginTop: 12 }}>{feedbackStatus}</p>}
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

        <section className="card">
          <h3 className="card-title">Updates</h3>
          <p className="card-sub">
            The app checks for updates on startup. You can also check manually here.
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="label">Current version</span>
            <span className="muted">{appVersion ?? (isDesktop ? "…" : "—")}</span>
          </div>
          {updateError && <p className="auth-err" style={{ marginBottom: 12 }}>{updateError}</p>}
          {updateStatus && <p className="note-ok" style={{ marginBottom: 12 }}>{updateStatus}</p>}
          <button
            type="button"
            className="btn ghost sm"
            disabled={updateBusy}
            onClick={() => void handleCheckForUpdates()}
          >
            {updateBusy ? "Checking…" : "Check for updates"}
          </button>
        </section>

        <section className="card">
          <h3 className="card-title">Legal</h3>
          <p className="card-sub">
            Terms of Use and Privacy Policy for {isDesktop ? "the desktop app and" : ""} the
            ninesixteen.video website. Contact{" "}
            <a href="mailto:dev@ninesixteen.video">dev@ninesixteen.video</a> with questions.
          </p>
          <div className="row" style={{ gap: 8, justifyContent: "flex-start", flexWrap: "wrap" }}>
            <button className="btn ghost sm" onClick={() => openLegalPage("/terms")}>
              Terms of Use
            </button>
            <button className="btn ghost sm" onClick={() => openLegalPage("/privacy")}>
              Privacy Policy
            </button>
          </div>
          <p className="card-sub" style={{ marginTop: 14 }}>
            <a target="_blank" rel="noopener noreferrer" href="https://icons8.com/icon/xv1kwIOOUeFZ/cursor">
              mouse cursor
            </a>{" "}
            icon by{" "}
            <a target="_blank" rel="noopener noreferrer" href="https://icons8.com">
              Icons8
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
