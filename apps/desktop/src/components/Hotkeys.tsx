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
    keys: ["Alt", "F"],
    title: "Freeze / unfreeze frame",
    detail:
      "Lock the crop in place during the countdown or while recording. Unfreeze to ease back to your cursor.",
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

export function Hotkeys() {
  const globalKeys = HOTKEYS.filter((h) => h.group === "global");
  const framingKeys = HOTKEYS.filter((h) => h.group === "framing");

  return (
    <div className="scroll pad">
      <HotkeyGroup heading="Global" items={globalKeys} />
      <HotkeyGroup heading="Framing" items={framingKeys} />
      <p className="hk-foot">
        Snap to full 9×16 with Alt + scroll or Alt + ↓ — the frame pauses briefly when you land
        there.
      </p>
    </div>
  );
}

function HotkeyGroup({ heading, items }: { heading: string; items: HotkeyEntry[] }) {
  return (
    <section className="hk-group">
      <h3 className="hk-head">{heading}</h3>
      <ul className="hk-list">
        {items.map((item) => (
          <li key={item.title} className="hk-row">
            <div className="hk-text">
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
    <span className="combo" aria-hidden>
      {keys.map((key, i) => (
        <span key={key} className="combo-part">
          {i > 0 && <span className="combo-sep">+</span>}
          <kbd className="kbd">{key}</kbd>
        </span>
      ))}
    </span>
  );
}
