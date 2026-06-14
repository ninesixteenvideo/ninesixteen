# Wire-up guide

Everything below takes ninesixteen from **demo mode** (works today, accounts/billing
are faked locally) to **live mode** (real Google/email auth, real Stripe billing,
and a Pro entitlement shared between the web app and the desktop app).

> **The one idea to understand:** there is a single source of truth for who is Pro —
> the Firestore document `users/{uid}.plan` (`"trial"` = free, `"pro"` = paying).
> The Firebase **uid is the same** on web and desktop, so a purchase made in the
> browser unlocks **Export** in the desktop app in real time. Sign-in creates the
> user doc; the Stripe webhook upgrades it to `"pro"`.

```
Sign-in ──> POST /api/users/sync ──> Firestore users/{uid}.plan = "trial" (free)
Web checkout ──> Stripe ──> webhook ──> Firestore users/{uid}.plan = "pro"
                                              │
                          ┌───────────────────┴───────────────────┐
                     web app reads it                  desktop app reads it
                     (dashboard, pricing)              (unlocks Export live)
```

---

## 0. Prerequisites

- Node.js ≥ 20 and `pnpm` (repo uses `pnpm@9`)
- A Google account (for Firebase) and a Stripe account
- From the repo root: `pnpm install`

You can run **everything in demo mode right now** with no setup:
- `pnpm web:dev` → http://localhost:3000
- `pnpm desktop:dev` → launches the desktop app

Demo mode = local fake accounts, paywall is clickable but not enforced against a real
backend. Do the steps below when you're ready to go live.

---

## 1. Firebase (auth + entitlement database)

Both apps use **the same Firebase project**. This is mandatory — it's what makes the
shared uid / shared Pro status work.

### 1a. Create the project
1. Go to https://console.firebase.google.com → **Add project**.
2. Once created, click the **Web app** icon (`</>`) to register a web app. Copy the
   config values shown (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`). You'll paste these into **both** apps' env files.

### 1b. Enable sign-in providers
**Authentication → Sign-in method → Add provider:**
- Enable **Google** (set a support email).
- Enable **Email/Password**.

### 1c. Authorized domains
**Authentication → Settings → Authorized domains.** `localhost` is allowed by default
(covers desktop dev too). When you deploy the web app, add its domain here
(e.g. `ninesixteen.video`).

### 1d. Create the Firestore database
1. **Build → Firestore Database → Create database** (Production mode is fine).
2. Add this security rule so a signed-in user can read their **own** entitlement, but
   only the server (Admin SDK) can write it:

**Firestore → Rules:** (same as `firestore.rules` in the repo)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false; // server only: sign-in sync + Stripe webhook (Admin SDK)
    }
  }
}
```

On first sign-in (Google or email), the app calls **`POST /api/users/sync`**, which
creates `users/{uid}` with `plan: "trial"` (shown as **Free** in the UI). After a
Stripe purchase, the webhook sets `plan: "pro"`. You should see a document in
Firestore for every signed-in user — not only paying customers.

### 1e. Service account (for the webhook to write Firestore)
1. **Project settings → Service accounts → Generate new private key** → downloads a
   JSON file.
2. From that JSON you need three values for the web env: `project_id`, `client_email`,
   and `private_key`.
   - The `private_key` is multi-line. In `.env.local` keep it on **one line wrapped in
     double quotes** with the newlines written as `\n` (the code un-escapes them):
     `FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"`

---

## 2. Stripe (billing — $12/mo, $39/yr)

1. Stripe Dashboard → **Developers → API keys** → copy the **Secret key**
   (`sk_test_...` while testing).
2. **Product catalog → Add product** (e.g. "ninesixteen Pro"). Add **two recurring
   prices** to it:
   - **$12 / month** → copy its price id → `STRIPE_PRICE_ID_MONTHLY` (`price_...`)
   - **$39 / year** → copy its price id → `STRIPE_PRICE_ID_YEARLY` (`price_...`)
3. **Webhook** (the part that flips users to Pro):
   - **Developers → Webhooks → Add endpoint.**
   - URL: `https://YOUR_WEB_DOMAIN/api/stripe/webhook`
   - Events to send:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - After creating it, copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET`
     (`whsec_...`).
   - **Local testing:** install the Stripe CLI and run
     `stripe listen --forward-to localhost:3000/api/stripe/webhook` — it prints a
     `whsec_...` to use as `STRIPE_WEBHOOK_SECRET` locally.

---

## 3. Web app env — `apps/web/.env.local`

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in:

```bash
# Firebase client (from step 1a)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin (from step 1e)
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Stripe (from step 2)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID_MONTHLY=price_...
STRIPE_PRICE_ID_YEARLY=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Public URL of this web app (used by desktop to open checkout)
NEXT_PUBLIC_APP_URL=http://localhost:3000   # in prod: https://ninesixteen.video
```

> Note: only the `NEXT_PUBLIC_*` vars reach the browser. The Admin + Stripe secret keys
> stay server-side. Never commit `.env.local`.

---

## 4. Desktop app env — `apps/desktop/.env`

Copy `apps/desktop/.env.example` to `apps/desktop/.env`. Use the **same Firebase
client values** as the web app (this is what shares the uid / Pro status):

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Where the paywall sends people to subscribe
VITE_WEB_URL=http://localhost:3000   # in prod: https://ninesixteen.video
```

The desktop app needs **no** Stripe or Admin keys — it never touches Stripe directly;
it just reads the entitlement from Firestore and opens the web checkout in the browser.

---

## 5. Test the whole loop

1. Start both: `pnpm web:dev` and `pnpm desktop:dev` (and the `stripe listen` command
   if testing locally).
2. **Desktop:** click the account pill (top-right) → **Continue with Google** (or email).
3. Record something in Studio, then open **Preview** and hit **Export** → the
   **paywall** appears (you're on Free).
4. Click **Subscribe in browser** → the web pricing page opens. Sign in with the **same
   Google account**, pick monthly/yearly, complete checkout with a
   [Stripe test card](https://docs.stripe.com/testing) (`4242 4242 4242 4242`, any
   future expiry/CVC).
5. Stripe fires the webhook → Firestore `users/{uid}.plan` becomes `"pro"`.
6. **Back in the desktop app, Export unlocks automatically** (no restart) — the save
   dialog opens and copies the MP4 wherever you choose.

If you cancel in the **Stripe Customer Portal** (Dashboard → **Manage / cancel**, or
Account → **Manage subscription** in the desktop app):

- The webhook sets `plan: "pro"` **and** `proEndsAt` to the end of the current billing
  period (monthly or annual — taken from Stripe’s `current_period_end`).
- `subscriptionCancelAtPeriodEnd: true` is stored so the UI can show:
  *“Subscription cancelled — Pro access until [date].”*
- Pro stays unlocked until that date; when the period ends, the subscription is deleted
  and the plan returns to `"trial"`.

Enable the portal once in Stripe: **Settings → Billing → Customer portal** (turn it on).

---

## 6. Going to production (checklist)

- [ ] Switch Stripe to **live mode**: live secret key, recreate the two prices, create a
      live webhook endpoint, use the live `whsec_...`.
- [ ] Set `NEXT_PUBLIC_APP_URL` / `VITE_WEB_URL` to your real domain.
- [ ] Add your production domain to Firebase **Authorized domains**.
- [ ] Deploy the web app (e.g. Vercel) with all env vars set in the host's dashboard.
- [ ] Build the desktop app: `pnpm desktop:build` (env baked in at build time, so set
      `apps/desktop/.env` before building).
- [ ] Confirm the production webhook URL is reachable and receiving events
      (Stripe Dashboard → Webhooks → your endpoint → recent deliveries).

---

## Quick reference — where each value comes from

| Variable | Source | Used by |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` / `VITE_FIREBASE_*` | Firebase console → Web app config | Web + Desktop (auth, read plan) |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Firebase service-account JSON | Web webhook (writes plan) |
| `STRIPE_SECRET_KEY` | Stripe → API keys | Web checkout + webhook |
| `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_YEARLY` | Stripe → Product prices | Web checkout |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhook endpoint (or `stripe listen`) | Web webhook |
| `NEXT_PUBLIC_APP_URL` / `VITE_WEB_URL` | Your web app's URL | Desktop → opens checkout |

## Troubleshooting

- **Plan never flips to Pro:** the webhook isn't reaching your server or `whsec_` is
  wrong. Check Stripe → Webhooks → recent deliveries, and that Admin creds are set
  (otherwise the webhook runs in mock mode and skips the Firestore write).
- **Desktop Export stays locked after subscribing:** make sure you signed into the
  desktop and the web checkout with the **same** account; confirm the Firestore doc
  `users/{uid}.plan` is `"pro"`.
- **Google popup fails on desktop:** use the email/password option as a fallback, and
  ensure your domain is in Firebase Authorized domains.
- **Desktop sign-in shows “Failed to fetch”:**
  - **Google sign-in:** the desktop app calls `https://ninesixteen.video/api/auth/...`
    from the Tauri WebView (`https://tauri.localhost`). The web API must allow that
    origin (CORS) and have **Firebase Admin** env vars set on Vercel — otherwise the
    handoff endpoints return 503.
  - **Email/password sign-in:** talks directly to Firebase. If your Google Cloud **API
    key** has HTTP referrer restrictions, add `https://tauri.localhost/*` (and
    `http://localhost:1420/*` for dev). Restrictions that only list your website
    domain will block the desktop app.
  - Rebuild the desktop app after changing `apps/desktop/.env` (`pnpm desktop:build`).
- **Video won't play in Preview:** recordings must live under `Videos/ninesixteen` —
  that's the path allowed by the Tauri asset-protocol scope in `tauri.conf.json`.
- **Still in demo mode?** That means one or more env vars are blank — the apps fall
  back to local fakes on purpose so dev never breaks.
