import { useEffect } from "react";

type HotkeyEntry = {
  keys: string[];
  title: string;
  detail: string;
  group: "global" | "framing";
};

const HOTKEYS: HotkeyEntry[] = [
  {
    group: "global",
    keys: ["Alt", "R"],
    title: "Start / stop recording",
    detail: "Works while the app is minimized. Cancels the countdown if one is running.",
  },
  {
    group: "global",
    keys: ["Alt", "V"],
    title: "Show or hide frame",
    detail: "Toggle the on-desktop 9×16 overlay when you're not recording.",
  },
  {
    group: "framing",
    keys: ["Alt", "Scroll"],
    title: "Zoom in / out (mouse)",
    detail: "Hold Alt and scroll the wheel to crop tighter or pull back to full desktop.",
  },
  {
    group: "framing",
    keys: ["Alt", "↑ / ↓"],
    title: "Zoom in / out (keyboard)",
    detail: "On a laptop trackpad, hold Alt and press ↑ or ↓ — works the same as the wheel.",
  },
  {
    group: "framing",
    keys: ["Mouse"],
    title: "Move the frame",
    detail: "The viewport follows your cursor during the countdown and while recording.",
  },
];

export function HotkeysModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const globalKeys = HOTKEYS.filter((h) => h.group === "global");
  const framingKeys = HOTKEYS.filter((h) => h.group === "framing");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hotkeys-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="hotkeys-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <h2 id="hotkeys-title" className="hotkeys-title">
          Keyboard shortcuts
        </h2>
        <p className="muted hotkeys-sub">
          Global shortcuts work even when ninesixteen.video is minimized during capture.
        </p>

        <HotkeyGroup heading="Global" items={globalKeys} />
        <HotkeyGroup heading="Framing" items={framingKeys} />

        <p className="hotkeys-foot muted">
          Snap to full 9×16 with Alt + scroll or Alt + ↓ — the frame pauses briefly when you land there.
        </p>
      </div>
    </div>
  );
}

function HotkeyGroup({ heading, items }: { heading: string; items: HotkeyEntry[] }) {
  return (
    <section className="hotkeys-group">
      <h3 className="hotkeys-group-head">{heading}</h3>
      <ul className="hotkeys-list">
        {items.map((item) => (
          <li key={item.title} className="hotkeys-row">
            <div className="hotkeys-row-text">
              <b>{item.title}</b>
              <span className="muted">{item.detail}</span>
            </div>
            <KeyCombo keys={item.keys} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="hotkeys-combo" aria-hidden>
      {keys.map((key, i) => (
        <span key={key} className="hotkeys-combo-part">
          {i > 0 && <span className="hotkeys-combo-sep">+</span>}
          <kbd className="kbd">{key}</kbd>
        </span>
      ))}
    </span>
  );
}
