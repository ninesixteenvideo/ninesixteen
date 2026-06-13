import type { LegalSection } from "@/lib/legalMeta";
import {
  LEGAL_CONTACT_EMAIL,
  OPERATOR_LOCATION,
  OPERATOR_NAME,
  SERVICE_NAME,
  SITE_URL,
} from "@/lib/legalMeta";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    paragraphs: [
      `This Privacy Policy explains how ${OPERATOR_NAME} ("we," "us," or "our"), operated from ${OPERATOR_LOCATION}, collects, uses, discloses, stores, and protects personal information when you use our website at ${SITE_URL}, our Windows desktop application, and related services (the "Service"). The Service is available globally.`,
      `We aim to handle personal information in line with the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs), and to respect comparable rights under laws such as the EU/UK GDPR and US state privacy laws where they apply to us.`,
      `By using the Service, you acknowledge this Privacy Policy. If you do not agree, do not use the Service.`,
    ],
  },
  {
    id: "controller",
    title: "2. Who is responsible for your information",
    paragraphs: [
      `For the purposes of applicable privacy law, ${OPERATOR_NAME} (operating from ${OPERATOR_LOCATION}) is the entity responsible for personal information described in this policy, except where a third party processes information under its own policy (for example, Stripe processing payment card data).`,
      `Privacy contact: ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
  {
    id: "summary",
    title: "3. Summary",
    paragraphs: [
      `The Service is local-first: your screen recordings stay on your device unless you choose to export them. We collect account and subscription information to operate sign-in and Pro billing, and we use short-lived server sessions to complete browser-based sign-in and Google Drive authorization for the desktop app.`,
      `We do not sell personal information. We do not use your recordings for advertising or model training.`,
    ],
    bullets: [
      "Recordings: stored locally on your computer; not uploaded to our servers by default.",
      "Account data: email, name, and subscription status stored in Firebase/Firestore when you create an account.",
      "Payments: processed by Stripe; we receive billing status and customer identifiers, not full card numbers.",
      "Google Drive export: optional; you authorize Google directly; we temporarily relay an access token to your desktop app to complete export.",
    ],
  },
  {
    id: "collect",
    title: "4. Information we collect",
    paragraphs: [`The information we collect depends on how you use the Service.`],
  },
  {
    id: "account",
    title: "4a. Account and profile information",
    paragraphs: [
      `When you create an account (via email/password or Google sign-in through Firebase Authentication), we collect information such as your email address, display name, Firebase user ID, and authentication metadata needed to secure your account.`,
      `When you sign in, our servers create or update a profile document in Google Cloud Firestore (for example, \`users/{uid}\`) with your email, display name, plan tier ("trial" for free or "pro" for paid), and subscription-related fields updated by our Stripe webhook (such as Stripe customer ID, subscription status, and Pro end date if applicable).`,
    ],
  },
  {
    id: "billing",
    title: "4b. Payment information",
    paragraphs: [
      `If you subscribe to Pro, checkout is handled by Stripe. Stripe collects payment method details directly. We receive information such as billing status, subscription identifiers, customer ID, and limited billing metadata from Stripe so we can unlock Pro features.`,
      `We do not store full payment card numbers on our servers.`,
    ],
  },
  {
    id: "desktop",
    title: "4c. Desktop app usage",
    paragraphs: [
      `The desktop app captures screen content, optional microphone and/or system audio, cursor position, and settings you choose (resolution up to 1080p, frame rate, zoom sensitivity, and similar options) to perform recording and virtual camera features.`,
      `This capture data is processed on your device. Recordings are written to local storage on your computer in an encrypted format for the free tier. We do not receive your raw recordings unless you explicitly use a feature that sends data elsewhere (such as Google Drive export).`,
      `The desktop app may store sign-in session tokens, Google Drive access tokens (when you connect Drive), and preferences locally on your device.`,
    ],
  },
  {
    id: "web",
    title: "4d. Website usage and cookies",
    paragraphs: [
      `When you visit our website, our hosting provider (Vercel) and related infrastructure may automatically log standard technical data such as IP address, browser type, device type, pages viewed, and timestamps for security, performance, and debugging.`,
      `We use essential cookies and similar technologies only as needed to operate the website (for example, authentication session cookies when you sign in). We do not use advertising cookies or sell cookie data. You can control cookies through your browser settings; disabling essential cookies may affect sign-in.`,
      `If we add analytics or error monitoring tools in the future, we will update this policy and, where required, obtain consent before non-essential tracking.`,
    ],
  },
  {
    id: "auth-handoff",
    title: "4e. Browser authentication handoffs",
    paragraphs: [
      `Because the desktop app opens your system browser for sign-in, Google sign-in, Google Drive authorization, and Stripe checkout, we use short-lived server-side session records (for example, in Firestore collections such as \`desktopAuthSessions\` and \`driveAuthSessions\`) to pass authorization results back to the desktop app.`,
      `These sessions contain random one-time codes, may include Firebase custom tokens or Google Drive access tokens for a limited time, and are deleted after use or expiry (typically within ten minutes). They are not used for advertising or profiling.`,
    ],
  },
  {
    id: "support",
    title: "4f. Information you send us",
    paragraphs: [
      `If you contact us at ${LEGAL_CONTACT_EMAIL}, we receive whatever information you choose to include (such as your email address, name, and the content of your request).`,
    ],
  },
  {
    id: "legal-bases",
    title: "5. Legal bases for processing (EEA, UK, and similar regions)",
    paragraphs: [
      `Where the GDPR or UK GDPR applies, we process personal information on the following bases:`,
    ],
    bullets: [
      "Contract: to provide the Service, manage your account, and fulfil subscriptions.",
      "Legitimate interests: to secure the Service, prevent fraud and abuse, improve features, and communicate about the Service in a proportionate way that respects your rights.",
      "Consent: where you choose Google sign-in, Google Drive export, or optional communications that require consent under local law. You may withdraw consent where processing is consent-based, without affecting the lawfulness of prior processing.",
      "Legal obligation: where we must retain or disclose information to comply with law.",
    ],
  },
  {
    id: "use",
    title: "6. How we use information",
    paragraphs: [`We use personal information to:`],
    bullets: [
      "Provide, maintain, and improve the Service, including recording, preview, export, and virtual camera features.",
      "Create and manage accounts and authenticate you on web and desktop.",
      "Process subscriptions, unlock Pro features, and manage billing through Stripe.",
      "Complete browser-to-desktop authorization flows for sign-in and Google Drive export.",
      "Respond to support requests and send service-related messages (for example, security notices or subscription confirmations).",
      "Monitor security, prevent fraud and abuse, and enforce our Terms of Use.",
      "Comply with legal obligations and establish, exercise, or defend legal claims.",
    ],
  },
  {
    id: "marketing",
    title: "7. Marketing and communications",
    paragraphs: [
      `We may send transactional messages necessary to provide the Service (for example, account verification, billing receipts via Stripe, or responses to support requests).`,
      `We do not send third-party advertising based on your recordings or account activity. If we ever send optional marketing email, we will do so only where permitted by law (including obtaining consent where required under Australia's Spam Act 2003 and similar laws) and you will be able to opt out.`,
    ],
  },
  {
    id: "share",
    title: "8. How we disclose information",
    paragraphs: [
      `We do not sell or share personal information for cross-context behavioural advertising. We disclose information only as described below:`,
    ],
    bullets: [
      "Service providers (processors): vendors that help us run the Service, listed in section 13. They process data on our instructions and under contractual safeguards where available.",
      "Your directions: when you export to Google Drive, files are uploaded to your Google account using the permissions you grant.",
      "Legal and safety: if required by law, court order, or to protect rights, safety, and security of users, the public, or the Service.",
      "Business transfers: if we are involved in a merger, acquisition, or asset sale, information may be transferred subject to this Privacy Policy.",
    ],
  },
  {
    id: "overseas",
    title: "9. Overseas disclosure and international transfers",
    paragraphs: [
      `We operate from ${OPERATOR_LOCATION}. Our service providers may process personal information in Australia, the United States, the European Union, and other countries where they operate data centres.`,
      `Under APP 8, before we disclose personal information overseas we take reasonable steps to ensure recipients handle it in accordance with applicable privacy law, or we rely on an exception permitted by law. Where the GDPR or UK GDPR applies, we rely on appropriate safeguards for transfers (such as standard contractual clauses offered by vendors, adequacy decisions, or other lawful mechanisms).`,
      `By using the Service, you understand that your information may be processed outside your home country, including in countries that may not provide the same level of protection as your local laws. Mandatory local rights still apply where required by law.`,
    ],
  },
  {
    id: "retention",
    title: "10. Data retention",
    paragraphs: [
      `We keep personal information only as long as reasonably necessary for the purposes described in this policy:`,
    ],
    bullets: [
      "Account and subscription records: while your account is active and for a reasonable period afterward for billing, tax, dispute, and legal compliance purposes (typically up to seven years for financial records where required).",
      "Authentication and Drive handoff sessions: deleted after use or within about ten minutes.",
      "Support emails: as long as needed to resolve your request and maintain a reasonable support history.",
      "Local recordings and exports: remain on your device until you delete them; we do not control retention on your computer or in your Google Drive.",
    ],
  },
  {
    id: "security",
    title: "11. Security",
    paragraphs: [
      `We use administrative, technical, and organisational measures designed to protect personal information, including encrypted transport (HTTPS), Firebase security rules that restrict direct client writes to entitlement data, and server-only updates for subscription state.`,
      `Free-tier recordings use at-rest encryption on your device intended to reduce casual copying; this is not unbreakable DRM. Pro export decrypts files you choose to save.`,
      `No method of transmission or storage is completely secure. You are responsible for securing your device, account credentials, and exported files.`,
    ],
  },
  {
    id: "breaches",
    title: "12. Data breaches",
    paragraphs: [
      `If we become aware of unauthorised access to personal information we hold that is likely to result in serious harm (or otherwise triggers notification obligations under applicable law), we will take steps to contain the incident, assess the impact, and notify affected individuals and regulators as required—including under Australia's Notifiable Data Breaches scheme and, where applicable, GDPR breach notification rules.`,
    ],
  },
  {
    id: "processors",
    title: "13. Service providers we use",
    paragraphs: [`We use the following categories of service providers. Each has its own privacy policy:`],
    bullets: [
      "Google Firebase / Firestore (authentication, user profiles, short-lived auth sessions) — may process data in the US and other regions.",
      "Google OAuth / Google Drive API (optional sign-in and Drive export) — when you choose those features.",
      "Stripe (subscription checkout, billing portal, payment processing) — may process data in the US and other regions.",
      "Vercel (website hosting and edge delivery) — may process technical logs globally.",
    ],
  },
  {
    id: "rights-au",
    title: "14. Your rights — Australia",
    paragraphs: [
      `We handle personal information in accordance with the APPs. Depending on your circumstances, you may have the right to ask whether we hold personal information about you, request access to it, request correction of inaccurate or out-of-date information, and make a complaint about our handling of personal information.`,
      `To exercise these rights, email ${LEGAL_CONTACT_EMAIL}. We will respond within a reasonable period (usually within 30 days). We may need to verify your identity.`,
      `If you are not satisfied with our response, you may contact the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au.`,
      `Small businesses with an annual turnover under AUD $3 million may be exempt from the Privacy Act in some cases; regardless of whether an exemption applies, we follow the practices described in this policy because we believe they are appropriate for our users globally.`,
    ],
  },
  {
    id: "rights-gdpr",
    title: "15. Your rights — EEA, UK, and similar regions",
    paragraphs: [
      `Where the GDPR or UK GDPR applies, you may have the right to access, rectify, erase, restrict, or object to certain processing, and to data portability for information processed on contract or consent bases. Where processing is based on consent, you may withdraw consent at any time.`,
      `You may lodge a complaint with your local supervisory authority. In the EU, see edpb.europa.eu; in the UK, see ico.org.uk.`,
      `To exercise these rights, email ${LEGAL_CONTACT_EMAIL}. We will respond within one month unless an extension is permitted by law.`,
      `We do not make solely automated decisions about you that produce legal or similarly significant effects without appropriate safeguards.`,
    ],
  },
  {
    id: "rights-us",
    title: "16. Your rights — United States (including California)",
    paragraphs: [
      `We do not sell or share personal information for cross-context behavioural advertising as those terms are defined under California law.`,
      `Depending on your state of residence, you may have rights to know what personal information we collect, request deletion or correction, and not be discriminated against for exercising privacy rights. Because recordings stay on your device by default, much of the content you create is not personal information we hold on our servers.`,
      `To submit a request, email ${LEGAL_CONTACT_EMAIL} with "Privacy request" in the subject line and enough information for us to verify your account. We will respond as required by applicable law.`,
    ],
  },
  {
    id: "rights-general",
    title: "17. How to make a privacy request",
    paragraphs: [
      `Whatever your location, you can email ${LEGAL_CONTACT_EMAIL} to request access, correction, deletion of account data we control, or information about how we handle your personal information.`,
      `We may decline requests where permitted by law (for example, where we must retain billing records, where a request is excessive or unfounded, or where deletion would prevent us from providing the Service you still use).`,
      `If you delete your account, we will delete or de-identify personal information we no longer need, except where retention is required by law or legitimate business needs such as fraud prevention and tax records.`,
    ],
  },
  {
    id: "children",
    title: "18. Children's privacy",
    paragraphs: [
      `The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us personal information, contact ${LEGAL_CONTACT_EMAIL} and we will take appropriate steps to delete it.`,
      `In the EEA/UK, we do not knowingly offer the Service to children below the applicable digital consent age without appropriate parental authority.`,
    ],
  },
  {
    id: "changes",
    title: "19. Changes to this Privacy Policy",
    paragraphs: [
      `We may update this Privacy Policy from time to time. We will post the revised policy at ${SITE_URL}/privacy and update the effective date. Material changes will be communicated through the Service or by email where appropriate and, where required by law, we will obtain consent before material changes to how we use personal information.`,
      `Continued use after non-material changes become effective means you acknowledge the updated policy where permitted by law.`,
    ],
  },
  {
    id: "contact",
    title: "20. Contact and complaints",
    paragraphs: [
      `Privacy questions, access or correction requests, and complaints: ${LEGAL_CONTACT_EMAIL}.`,
      `Australian users may also contact the OAIC at oaic.gov.au. EEA/UK users may contact their local data protection authority. We will review complaints promptly and try to resolve them in good faith.`,
    ],
  },
];
