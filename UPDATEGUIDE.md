# How to release the desktop app

This is the **only release path we use**: push a tag → GitHub Actions builds the signed `.exe` → you publish the draft release → update the website download URL.

While you're developing, use **`pnpm desktop:dev`** (iterate) or **`pnpm desktop:build`** (optional local installer test). You do **not** upload installers by hand.

---

## The big picture

| What | How |
|------|-----|
| **Iterate locally** | `pnpm desktop:dev` or `pnpm desktop:build` |
| **Ship to users** | Tag → GitHub Actions → Publish release → Vercel URL |
| **Installer hosting** | GitHub Releases (free) |
| **In-app auto-update** | App reads `latest.json` from GitHub Releases |
| **Website download button** | Vercel env var pointing at the release `.exe` |

---

## How auto-update works

1. A user has the app installed.
2. On startup (and in **Settings → Updates**), the app checks:
   `https://github.com/ninesixteenvideo/ninesixteen/releases/latest/download/latest.json`
3. If a **newer signed version** exists, the app offers **Update now**.
4. User accepts → download → install → restart.

Updates only work after you **Publish** the GitHub release (draft is not enough).

---

## One-time setup (already done if you followed along)

### 1. Signing keys

```powershell
cd c:\ninesixteen\apps\desktop
pnpm tauri signer generate -w "$env:USERPROFILE\.ninesixteen-signing.key"
```

- Remember the password.
- **Never commit** `.ninesixteen-signing.key` (it's in `.gitignore`).
- Paste the **public** key from `.ninesixteen-signing.key.pub` into `apps/desktop/src-tauri/tauri.conf.json` → `"pubkey"`.
- Commit and push the public key only.

### 2. GitHub Actions secrets

**GitHub → ninesixteenvideo/ninesixteen → Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Entire contents of `%USERPROFILE%\.ninesixteen-signing.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Your key password |
| `VITE_FIREBASE_API_KEY` | Same **value** as `NEXT_PUBLIC_FIREBASE_API_KEY` in web `.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Same value as `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `VITE_FIREBASE_PROJECT_ID` | Same value as `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Same value as `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Same value as `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `VITE_FIREBASE_APP_ID` | Same value as `NEXT_PUBLIC_FIREBASE_APP_ID` |

Same Firebase project, different env var **names** (web uses `NEXT_PUBLIC_*`, the CI build uses `VITE_*`).

### 3. Workflow on GitHub

The file `.github/workflows/desktop-release.yml` must be on the **`master`** branch. Pushing a tag `desktop-v*` triggers it automatically.

---

## Every release (step by step)

### Step 1 — Develop and test locally

```powershell
pnpm desktop:dev
```

When you're happy, optionally sanity-check a local release build:

```powershell
pnpm desktop:build
```

Installer output (local only): `apps/desktop/src-tauri/target/release/bundle/`

This local build is **not** what you upload — GitHub Actions builds the real release.

---

### Step 2 — Bump the version

Pick a version (`0.1.0`, `0.1.1`, …). Update **all four** to the same number:

| File | What to change |
|------|----------------|
| `apps/desktop/src-tauri/tauri.conf.json` | `"version": "0.1.1"` |
| `apps/desktop/src-tauri/Cargo.toml` | `version = "0.1.1"` |
| `apps/desktop/package.json` | `"version": "0.1.1"` |
| `apps/web/.env.example` | `NEXT_PUBLIC_DESKTOP_VERSION=0.1.1` |

---

### Step 3 — Commit and push to `master`

```powershell
cd c:\ninesixteen
git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/package.json apps/web/.env.example
git commit -m "Release desktop v0.1.1"
git push origin master
```

**Important:** Push to `master` **before** you tag. The tag must point at a commit that includes your latest code and workflow fixes.

---

### Step 4 — Tag and push (starts the build)

Tag format **must** be `desktop-v` + version:

```powershell
git tag desktop-v0.1.1
git push origin desktop-v0.1.1
```

This automatically starts **Actions → Desktop release**. You do **not** need to click "Re-run all jobs".

A successful build takes about **20–30 minutes**.

---

### Step 5 — Watch Actions, then publish the release

1. **GitHub → Actions** → open the **newest** Desktop release run (triggered by your tag push).
2. Wait for a **green** checkmark.
3. **GitHub → Releases** → open the **Draft** (e.g. `ninesixteen.video desktop-v0.1.1`).
4. Confirm **Assets** include:
   - `ninesixteen.video_0.1.1_x64-setup.exe` (or similar NSIS `.exe`)
   - `latest.json`
   - `.sig` signature files
5. Click **Publish release**.

---

### Step 6 — Update the website (Vercel)

The `/download` page does not auto-update — you set the URL manually.

1. On the **published** release, right-click the **`.exe` installer** → **Copy link address**.
2. **Vercel → Settings → Environment Variables:**
   - `NEXT_PUBLIC_DESKTOP_INSTALLER_URL` = that URL
   - `NEXT_PUBLIC_DESKTOP_VERSION` = `0.1.1`
3. **Redeploy** the web app.

---

### Step 7 — Smoke test

- **New users:** `/download` installs the new `.exe`.
- **Existing users:** app prompts for update on launch, or **Settings → Updates → Check for updates**.

---

## If a release build failed

### Read the failed run

**Actions** → click the red run → expand the failed step → read the log.

Do **not** rely on **Re-run all jobs** on an old failed run if you fixed something on `master` afterward — re-runs still use the **commit the tag points at**.

### Fix on `master`, then move the tag

After pushing a fix to `master`:

```powershell
cd c:\ninesixteen
git tag -d desktop-v0.1.0
git push origin :refs/tags/desktop-v0.1.0
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Or bump to a new version and tag `desktop-v0.1.1` instead.

### Common failures

| Error | Fix |
|-------|-----|
| `Multiple versions of pnpm specified` | Workflow must **not** set `version:` on `pnpm/action-setup` — it reads `packageManager` from root `package.json`. Tag must include that fix (re-tag on latest `master`). |
| `MSBuild not found` during fetch-softcam | Fixed in repo via `setup-msbuild` + Enterprise MSBuild paths. Re-tag on latest `master`. |
| Missing Firebase / signing secrets | Add or fix secrets under GitHub Actions settings. |
| Build still running | Normal — wait 20–30 min. Failures in the first ~30 seconds are setup issues; long runs that fail are compile/signing issues. |

---

## What users see

| Situation | Result |
|-----------|--------|
| Download from website | Gets `.exe` from your Vercel URL (GitHub Releases link) |
| Already installed, newer release published | In-app update prompt |
| `pnpm desktop:dev` | No auto-update (dev build) |
| Already on latest version | Settings → "You're on the latest version." |

---

## Quick reference

| Item | Value |
|------|--------|
| Repo | https://github.com/ninesixteenvideo/ninesixteen |
| Branch | `master` |
| Release tag | `desktop-v0.1.1` (must start with `desktop-v`) |
| CI workflow | `.github/workflows/desktop-release.yml` |
| Version source of truth | `apps/desktop/src-tauri/tauri.conf.json` |
| Updater manifest | `releases/latest/download/latest.json` |
| Private signing key (local only) | `%USERPROFILE%\.ninesixteen-signing.key` |
| Local dev | `pnpm desktop:dev` |
| Local test build (optional) | `pnpm desktop:build` |
