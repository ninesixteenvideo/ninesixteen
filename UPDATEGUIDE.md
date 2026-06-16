# How to release a new desktop version

This guide walks you through **every step** to ship a new `ninesixteen.video` desktop build with **automatic in-app updates**.

You only do the **one-time setup** once. After that, each release is mostly: bump version → tag → publish → update download link.

---

## How auto-update works (simple version)

1. Your app is installed on a user's PC.
2. On startup (and from **Settings → Updates**), the app fetches a small file from GitHub:
   `https://github.com/ninesixteenvideo/ninesixteen/releases/latest/download/latest.json`
3. If that file says a **newer signed version** exists, the app asks to update.
4. The user clicks **Update now** → download → install → restart.

GitHub Releases hosts the installers **for free**. Signing keys prove the update really came from you.

---

## One-time setup (do this once)

### Step 1 — Generate updater signing keys

Open **PowerShell** in the project folder (`c:\ninesixteen`):

```powershell
cd c:\ninesixteen\apps\desktop
pnpm tauri signer generate -w "$env:USERPROFILE\.ninesixteen-signing.key"
```

- Choose a **password** when asked (remember it).
- This creates a **private key file** on your PC. **Never commit it. Never share it.**

The command prints a **public key** (a long string). Copy it.

### Step 2 — Paste the public key into the app config

Open:

`apps/desktop/src-tauri/tauri.conf.json`

Find:

```json
"pubkey": "PASTE_YOUR_TAURI_UPDATER_PUBLIC_KEY_HERE"
```

Replace that value with your **public key** string from Step 1.

Commit and push this change (public key is safe to commit).

### Step 3 — Add GitHub secrets

Go to: **GitHub → ninesixteenvideo/ninesixteen → Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret name | What to put there |
|-------------|-------------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Open your key file (`%USERPROFILE%\.ninesixteen-signing.key`) in Notepad. Copy **the entire contents** and paste as the secret value. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose in Step 1 (leave blank if you didn't set one). |
| `VITE_FIREBASE_API_KEY` | Same value as in your web `.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Same |
| `VITE_FIREBASE_PROJECT_ID` | Same |
| `VITE_FIREBASE_STORAGE_BUCKET` | Same |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Same |
| `VITE_FIREBASE_APP_ID` | Same |

These Firebase secrets are required so the **release build** can sign in and verify Pro licenses.

### Step 4 — Push the workflow file

Make sure `.github/workflows/desktop-release.yml` is on your `main` branch (commit + push if you haven't already).

### Step 5 — Create your first GitHub Release manually (v0.1.0 only)

The auto-updater needs **at least one** published release with `latest.json` on GitHub.

For your **very first** public release you can either:

**Option A — Tag and let GitHub Actions build it (recommended)**

Skip to [Every release checklist](#every-release-checklist) below and tag `desktop-v0.1.0`.

**Option B — Build locally and upload by hand**

```powershell
cd c:\ninesixteen
pnpm install
node scripts/fetch-ffmpeg.mjs
node scripts/fetch-softcam.mjs
# Ensure apps/desktop/.env has your VITE_FIREBASE_* values
pnpm desktop:build
```

Upload the files from:

`apps/desktop/src-tauri/target/release/bundle/`

to a new GitHub Release (see Step 6 in the release checklist).

---

## Every release checklist

Use this **every time** you ship a new desktop version.

### Step 1 — Decide the new version number

Use [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

Examples:

- `0.1.0` → `0.1.1` (small fix)
- `0.1.1` → `0.2.0` (new feature)
- `0.2.0` → `1.0.0` (big launch)

### Step 2 — Bump the version in these 4 files

All four must match:

| File | Field |
|------|--------|
| `apps/desktop/src-tauri/tauri.conf.json` | `"version": "0.1.1"` |
| `apps/desktop/src-tauri/Cargo.toml` | `version = "0.1.1"` |
| `apps/desktop/package.json` | `"version": "0.1.1"` |
| `apps/web/.env.example` | `NEXT_PUBLIC_DESKTOP_VERSION=0.1.1` |

Also update **Vercel** env var `NEXT_PUBLIC_DESKTOP_VERSION` to the same number (Step 6 below).

### Step 3 — Commit the version bump

In GitHub Desktop or terminal:

```powershell
cd c:\ninesixteen
git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/package.json apps/web/.env.example
git commit -m "Release desktop v0.1.1"
git push
```

(Replace `0.1.1` with your real version.)

### Step 4 — Create and push a release tag

The tag **must** start with `desktop-v`:

```powershell
git tag desktop-v0.1.1
git push origin desktop-v0.1.1
```

This triggers the **Desktop release** GitHub Action.

### Step 5 — Wait for the build & publish the draft release

1. Open **GitHub → Actions** tab.
2. Click the running **Desktop release** workflow.
3. Wait until it finishes green (usually 15–30 minutes).
4. Go to **GitHub → Releases**.
5. You should see a **Draft** release named `ninesixteen.video desktop-v0.1.1`.
6. Check the attached files include at least:
   - `latest.json` (required for auto-update)
   - `*.exe` or `*.msi` installer
   - `.sig` signature files
7. Edit release notes if you want, then click **Publish release**.

> **Important:** Auto-update only works for users after the release is **Published**, not while it's still a draft.

### Step 6 — Update the website download link (Vercel)

The landing page `/download` button uses an env var, not auto-update.

1. On the published GitHub Release, right-click the **NSIS `.exe` installer** (filename like `ninesixteen.video_0.1.1_x64-setup.exe`) → **Copy link address**.
2. In **Vercel → Project → Settings → Environment Variables**, set:
   - `NEXT_PUBLIC_DESKTOP_INSTALLER_URL` = that copied URL
   - `NEXT_PUBLIC_DESKTOP_VERSION` = `0.1.1` (same as release)
3. **Redeploy** the web app (Deployments → … → Redeploy).

New visitors download the latest installer. Existing users get prompted in-app.

### Step 7 — Smoke test

1. Install the **previous** version on a test PC (or keep your current install).
2. Launch the app → after a few seconds you should see **Update available**.
3. Or go to **Settings → Updates → Check for updates**.
4. Confirm update installs and the app restarts on the new version.

---

## What users experience

| Situation | What happens |
|-----------|----------------|
| Fresh install from website | Downloads installer from `/download` |
| Already installed, new release published | Prompt on startup or via Settings |
| Dev build (`pnpm desktop:dev`) | No auto-update (expected) |
| Release build, already latest | Settings says "You're on the latest version." |

---

## Troubleshooting

### "Update check failed" / pubkey error

- Public key in `tauri.conf.json` doesn't match the private key in GitHub secrets.
- Re-run `pnpm tauri signer generate` or verify you pasted the correct public key.

### GitHub Action failed

- Open the failed job log in **Actions**.
- Common causes: missing Firebase secrets, missing signing secrets, Rust/Windows build error.

### Users don't get update prompts

- Release must be **Published** (not draft).
- Release must include `latest.json` (the workflow adds this when signing is configured).
- User's installed version must be **older** than the release version.
- User must be on a **release** build, not an old unsigned local build.

### Website still offers old installer

- Update `NEXT_PUBLIC_DESKTOP_INSTALLER_URL` on Vercel and redeploy.

---

## Quick reference

| Item | Location |
|------|----------|
| Version source of truth | `apps/desktop/src-tauri/tauri.conf.json` |
| Release tag format | `desktop-v0.1.1` |
| GitHub repo | https://github.com/ninesixteenvideo/ninesixteen |
| Updater manifest | `releases/latest/download/latest.json` |
| Local signing key (keep secret) | `%USERPROFILE%\.ninesixteen-signing.key` |
| CI workflow | `.github/workflows/desktop-release.yml` |
| User-facing update UI | Settings → Updates |

---

## Optional: build a release on your PC (without GitHub Actions)

Same as first-time Option B:

```powershell
cd c:\ninesixteen
pnpm install
node scripts/fetch-ffmpeg.mjs
node scripts/fetch-softcam.mjs
pnpm desktop:build
```

Set signing env vars before building if you want updater artifacts locally:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.ninesixteen-signing.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"
```

Output: `apps/desktop/src-tauri/target/release/bundle/`

Upload those files to a GitHub Release manually if needed.
