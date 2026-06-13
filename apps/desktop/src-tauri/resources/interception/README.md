# Interception driver binaries (Phase B — precision isolation)

This folder is where the [Interception](https://github.com/oblitum/Interception)
runtime binaries are bundled so ninesixteen.video can give the **director mouse**
true kernel-level isolation (its movement never touches your real cursor).

These binaries are **third-party** and are intentionally **not committed** to the
repo. Fetch them with:

```bash
node scripts/fetch-interception.mjs
```

That script downloads the official release and places:

- `install-interception.exe` — the driver installer (run elevated by the app)
- `interception.dll` — the x64 user-mode library (loaded at runtime)

After fetching, the app's **Settings → Precision isolation** card can install the
driver (UAC prompt) and reboot. On next launch the app auto-detects the driver
and switches to kernel isolation.
