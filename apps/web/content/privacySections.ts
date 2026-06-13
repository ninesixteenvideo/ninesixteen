import type { LegalSection } from "@/lib/legalMeta";
import { LEGAL_CONTACT_EMAIL, SERVICE_NAME, SITE_URL } from "@/lib/legalMeta";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    paragraphs: [
      `This Privacy Policy explains how ${SERVICE_NAME} ("we," "us," or "our") collects, uses, shares, and protects information when you use our website at ${SITE_URL}, our Windows desktop application, and related services (the "Service").`,
      `By using the Service, you agree to this Privacy Policy. If you do not agree, do not use the Service.`,
    ],
  },
  {
    id: "summary",
    title: "2. Summary",
    paragraphs: [
      `The Service is designed to be local-first: your screen recordings stay on your device unless you choose to export them. We collect account and billing information to operate sign-in and Pro subscriptions, and we use short-lived server sessions to complete browser-based sign-in and Google Drive authorization for the desktop app.`,
    ],
    bullets: [
      "Recordings: stored locally on your computer; not uploaded to our servers by default.",
      "Account data: email, name, and subscription status stored in Firebase/Firestore when you create an account.",
      "Payments: processed by Stripe; we receive subscription status and customer identifiers, not full card numbers.",
      "Google Drive export: optional; you authorize Google directly; we temporarily relay an access token to your desktop app to complete export.",
    ],
  },
  {
    id: "collect",
    title: "3. Information we collect",
    paragraphs: [
      `The information we collect depends on how you use the Service.`,
    ],
  },
  {
    id: "account",
    title: "3a. Account and profile information",
    paragraphs: [
      `When you create an account (via email/password or Google sign-in through Firebase Authentication), we collect information such as your email address, display name, Firebase user ID, and authentication metadata needed to secure your account.`,
      `When you sign in, our servers create or update a profile document in Google Cloud Firestore (for example, \`users/{uid}\`) with your email, display name, plan tier ("trial" for free or "pro" for paid), and subscription-related fields updated by our Stripe webhook (such as Stripe customer ID, subscription status, and Pro end date if applicable).`,
    ],
  },
  {
    id: "billing",
    title: "3b. Payment information",
    paragraphs: [
      `If you subscribe to Pro, checkout is handled by Stripe. Stripe collects payment method details directly. We receive information such as billing status, subscription identifiers, and customer ID from Stripe so we can unlock Pro features in the app.`,
      `We do not store full payment card numbers on our servers.`,
    ],
  },
  {
    id: "desktop",
    title: "3c. Desktop app usage",
    paragraphs: [
      `The desktop app captures screen content, optional microphone and/or system audio, cursor position, and settings you choose (resolution up to 1080p, frame rate, zoom sensitivity, and similar options) to perform recording and virtual camera features.`,
      `This capture data is processed on your device. Recordings are written to local storage on your computer in an encrypted format for the free tier. We do not receive your raw recordings unless you explicitly use a feature that sends data elsewhere (such as Google Drive export).`,
      `The desktop app may store sign-in session tokens, Google Drive access tokens (when you connect Drive), and preferences locally in the app's storage on your device.`,
    ],
  },
  {
    id: "web",
    title: "3d. Website usage",
    paragraphs: [
      `When you visit our website, our hosting provider (Vercel) and related infrastructure may automatically log standard technical data such as IP address, browser type, pages viewed, and timestamps for security, performance, and debugging.`,
      `If analytics or error monitoring tools are enabled in the future, we will update this policy to describe them.`,
    ],
  },
  {
    id: "auth-handoff",
    title: "3e. Browser authentication handoffs",
    paragraphs: [
      `Because the desktop app opens your system browser for sign-in, Google sign-in, Google Drive authorization, and Stripe checkout, we use short-lived server-side session records (for example, in Firestore collections such as \`desktopAuthSessions\` and \`driveAuthSessions\`) to pass authorization results back to the desktop app.`,
      `These sessions contain random one-time codes, may include Firebase custom tokens or Google Drive access tokens for a limited time, and are deleted after use or expiry (typically within minutes). They are not used for advertising or profiling.`,
    ],
  },
  {
    id: "support",
    title: "3f. Information you send us",
    paragraphs: [
      `If you contact us at ${LEGAL_CONTACT_EMAIL}, we receive whatever information you choose to include in your message (such as your email address, name, and the content of your request).`,
    ],
  },
  {
    id: "use",
    title: "4. How we use information",
    paragraphs: [
      `We use information we collect to:`,
    ],
    bullets: [
      "Provide, maintain, and improve the Service, including recording, preview, export, and virtual camera features.",
      "Create and manage accounts and authenticate you on web and desktop.",
      "Process subscriptions, unlock Pro features, and manage billing through Stripe.",
      "Complete browser-to-desktop authorization flows for sign-in and Google Drive export.",
      "Respond to support requests and communicate about the Service.",
      "Monitor security, prevent fraud and abuse, and enforce our Terms of Use.",
      "Comply with legal obligations.",
    ],
  },
  {
    id: "share",
    title: "5. How we share information",
    paragraphs: [
      `We do not sell your personal information. We share information only as described below:`,
    ],
    bullets: [
      "Service providers: We use vendors that help us run the Service, including Google (Firebase Authentication, Firestore), Stripe (payments), Vercel (website hosting), and Google APIs when you choose Google sign-in or Google Drive export. They process data on our behalf under their terms and privacy policies.",
      "Your directions: When you export to Google Drive, files are uploaded to your Google account using the permissions you grant.",
      "Legal and safety: We may disclose information if required by law, legal process, or to protect rights, safety, and security of users, the public, or the Service.",
      "Business transfers: If we are involved in a merger, acquisition, or asset sale, information may be transferred as part of that transaction, subject to this Privacy Policy.",
    ],
  },
  {
    id: "retention",
    title: "6. Data retention",
    paragraphs: [
      `Account and subscription records are retained while your account is active and as needed to provide the Service, comply with law, resolve disputes, and enforce agreements.`,
      `Short-lived authentication and Drive handoff sessions are deleted after completion or within a short TTL (on the order of minutes).`,
      `Local recordings and exports remain on your device until you delete them. Uninstalling the app does not necessarily delete files already saved on disk.`,
      `Stripe retains payment records according to its policies. You can manage billing data through Stripe's customer portal.`,
    ],
  },
  {
    id: "security",
    title: "7. Security",
    paragraphs: [
      `We use administrative, technical, and organizational measures designed to protect information, including encrypted transport (HTTPS), Firebase security rules that restrict direct client writes to entitlement data, and server-only updates for subscription state.`,
      `Free-tier recordings use at-rest encryption on your device intended to reduce casual copying; this is not unbreakable DRM. Pro export decrypts files you choose to save.`,
      `No method of transmission or storage is completely secure. You are responsible for securing your device, account credentials, and exported files.`,
    ],
  },
  {
    id: "choices",
    title: "8. Your choices and rights",
    paragraphs: [
      `Depending on where you live, you may have rights to access, correct, delete, or restrict processing of your personal information, or to object to certain processing.`,
      `You can update account details by signing in on the web. You can cancel Pro through the Stripe customer portal. You can delete local recordings in the desktop app. You can revoke Google Drive access in your Google account settings.`,
      `To request account deletion or exercise privacy rights, email ${LEGAL_CONTACT_EMAIL}. We may need to verify your identity before fulfilling requests.`,
      `If you are in the European Economic Area, UK, or certain other regions, you may also lodge a complaint with your local data protection authority.`,
    ],
  },
  {
    id: "children",
    title: "9. Children's privacy",
    paragraphs: [
      `The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us personal information, contact ${LEGAL_CONTACT_EMAIL} and we will take appropriate steps to delete it.`,
    ],
  },
  {
    id: "international",
    title: "10. International transfers",
    paragraphs: [
      `We operate from the United States and use service providers that may process data in the United States and other countries. Those countries may have data protection laws different from those in your jurisdiction.`,
      `Where required, we rely on appropriate safeguards for cross-border transfers (such as standard contractual clauses offered by vendors).`,
    ],
  },
  {
    id: "third-parties",
    title: "11. Third-party services",
    paragraphs: [
      `The Service integrates with third parties that have their own privacy practices. We encourage you to review their policies:`,
    ],
    bullets: [
      "Google Firebase (authentication and Firestore database)",
      "Google OAuth and Google Drive API (optional sign-in and Drive export)",
      "Stripe (subscription checkout and billing portal)",
      "Vercel (website hosting)",
    ],
  },
  {
    id: "changes",
    title: "12. Changes to this Privacy Policy",
    paragraphs: [
      `We may update this Privacy Policy from time to time. We will post the revised policy at ${SITE_URL}/privacy and update the effective date. Material changes may also be communicated through the Service or by email where appropriate.`,
      `Continued use after changes become effective means you accept the updated policy.`,
    ],
  },
  {
    id: "contact",
    title: "13. Contact us",
    paragraphs: [
      `Privacy questions or requests: ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
];
