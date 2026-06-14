import type { LegalSection } from "@/lib/legalMeta";
import {
  LEGAL_CONTACT_EMAIL,
  OPERATOR_LOCATION,
  OPERATOR_NAME,
  SERVICE_NAME,
  SITE_URL,
} from "@/lib/legalMeta";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    paragraphs: [
      `These Terms of Use ("Terms") govern your access to and use of the ${SERVICE_NAME} website at ${SITE_URL}, our Windows desktop application, and any related services we provide (collectively, the "Service").`,
      `By downloading, installing, accessing, or using the Service, you agree to these Terms and our Privacy Policy at ${SITE_URL}/privacy. If you do not agree, do not use the Service.`,
      `If you use the Service on behalf of an organization, you represent that you have authority to bind that organization, and "you" includes that organization. If you use the Service as a consumer for personal or household purposes, mandatory consumer laws may apply to you as described below.`,
    ],
  },
  {
    id: "operator",
    title: "2. Who we are",
    paragraphs: [
      `The Service is operated by ${OPERATOR_NAME} from ${OPERATOR_LOCATION}. The Service is available globally.`,
      `Contact: ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
  {
    id: "eligibility",
    title: "3. Eligibility",
    paragraphs: [
      `You must be at least 13 years old to use the Service. If you are under 18, you may use the Service only with the involvement and consent of a parent or legal guardian.`,
      `If you are in the European Economic Area or United Kingdom, you must be at least the age at which you can consent to online services in your country (often 16, or 13 with parental consent where permitted by local law).`,
      `You may not use the Service if you are barred from doing so under applicable law or if we have previously suspended or terminated your access.`,
    ],
  },
  {
    id: "service",
    title: "4. Description of the Service",
    paragraphs: [
      `${SERVICE_NAME} is a vertical desktop capture tool for Windows. The Service lets you frame a 9×16 region of your screen, record video (and optional audio), preview recordings inside the app, and—once you have purchased Pro—export decrypted MP4 files locally or to Google Drive.`,
      `We may update, change, or discontinue features at any time. We do not guarantee uninterrupted or error-free operation. Where the Service is supplied to Australian consumers, our obligations under the Australian Consumer Law (ACL) are not limited by this section.`,
    ],
  },
  {
    id: "accounts",
    title: "5. Accounts and authentication",
    paragraphs: [
      `You may use parts of the desktop app without an account. Creating an account lets you sync your Pro entitlement between the web app and desktop app and sign in across devices.`,
      `You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Notify us promptly at ${LEGAL_CONTACT_EMAIL} if you suspect unauthorized access.`,
      `You agree to provide accurate account information and to keep it up to date.`,
    ],
  },
  {
    id: "purchase",
    title: "6. Purchase, payment, and refunds",
    paragraphs: [
      `Pro is a one-time purchase that unlocks export features and related Pro benefits described on our pricing page. The current list price is US $49 unless we state otherwise at checkout. A purchase grants a lifetime license to the Pro features for your account — there is no recurring subscription or renewal. Prices may change for future purchases; a change does not affect a license you have already bought.`,
      `Payments are processed by Stripe. By purchasing, you also agree to Stripe's terms and privacy practices. We do not store full payment card numbers on our servers. Applicable taxes (including GST for Australian customers, where required) may be calculated and collected by Stripe at checkout.`,
      `Except where required by law (including the ACL and other mandatory consumer protection laws), fees already paid are non-refundable. If you believe you are entitled to a refund under applicable law, contact ${LEGAL_CONTACT_EMAIL} with your account email and reason for the request.`,
      `Chargebacks or payment disputes made without first contacting us may result in suspension of Pro access while the dispute is investigated.`,
    ],
  },
  {
    id: "free-pro",
    title: "7. Free tier and Pro features",
    paragraphs: [
      `The free tier lets you record and preview encrypted recordings stored locally on your device. Exporting decrypted MP4 files requires a one-time Pro purchase unless we explicitly state otherwise in the app.`,
      `Pro features and limits may change. Material reductions to Pro features will not apply retroactively to a license you have already purchased without reasonable notice.`,
    ],
    bullets: [
      "Free: local recording, in-app preview, and core capture settings.",
      "Pro: MP4 export to your computer (for example, Documents/Videos) and optional export to your Google Drive, plus other Pro benefits we describe in the product.",
    ],
  },
  {
    id: "recordings",
    title: "8. Your recordings and local data",
    paragraphs: [
      `Recordings are captured and stored on your computer by default. Free-tier recordings are stored in an encrypted format intended to prevent casual copying; Pro export decrypts them to standard MP4 files you choose to save.`,
      `You retain ownership of content you record, subject to third-party rights. You are solely responsible for what you capture, including obtaining any consents required by law when recording other people, confidential information, copyrighted material, or sensitive data visible on your screen or audible in your audio.`,
      `We do not routinely access, host, or review your recordings on our servers. Back up exports you care about; except where required by law, we are not responsible for loss of local files due to device failure, uninstallation, or user error.`,
    ],
  },
  {
    id: "exports",
    title: "9. Export and third-party integrations",
    paragraphs: [
      `Local export saves files to a folder on your device that you open in other apps. Google Drive export requires you to authorize Google separately; files are uploaded directly to your Google account using the permissions you grant.`,
      `Third-party services (including Google, Stripe, and your operating system) have their own terms and policies. We are not responsible for third-party outages, data handling, or account actions taken by those providers.`,
    ],
  },
  {
    id: "acceptable-use",
    title: "10. Acceptable use",
    paragraphs: [`You agree not to misuse the Service. Without limiting other restrictions, you may not:`],
    bullets: [
      "Use the Service for unlawful, fraudulent, harassing, or abusive purposes.",
      "Record or distribute content in violation of intellectual property, privacy, publicity, or other rights.",
      "Attempt to reverse engineer, decompile, or circumvent licensing, export, or encryption mechanisms except where such restriction is prohibited by law.",
      "Interfere with or disrupt the Service, servers, or networks, or probe systems without authorization.",
      "Resell, sublicense, or provide the Service to third parties as a hosted service without our written permission.",
      "Use automated means to scrape the website or abuse authentication, checkout, or API endpoints.",
    ],
  },
  {
    id: "ip",
    title: "11. Intellectual property",
    paragraphs: [
      `The Service, including software, branding, documentation, and website content (excluding your recordings), is owned by us or our licensors and is protected by intellectual property laws.`,
      `Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to install and use the desktop app and access the website for your personal or internal business purposes.`,
      `You may not copy, modify, distribute, sell, or lease any part of the Service except as expressly allowed by these Terms or applicable open-source licenses included with the software.`,
    ],
  },
  {
    id: "feedback",
    title: "12. Feedback",
    paragraphs: [
      `If you send suggestions, ideas, or feedback, you grant us a perpetual, irrevocable, worldwide, royalty-free license to use them without obligation to you, to the extent permitted by law. Do not send confidential or proprietary information you expect to be kept secret unless we agree in writing.`,
    ],
  },
  {
    id: "acl",
    title: "13. Australian Consumer Law",
    paragraphs: [
      `If you acquire the Service as a consumer under the ACL (generally for personal or household use), our goods and services come with guarantees that cannot be excluded under the ACL.`,
      `For a major failure with the Service, you may be entitled to a remedy such as cancellation and a refund. For a non-major failure, you may be entitled to have the failure remedied within a reasonable time; if we do not do so, you may be entitled to a refund or other remedy under the ACL.`,
      `Nothing in these Terms excludes, restricts, or modifies any consumer guarantee, right, or remedy under the ACL (or any other non-waivable consumer protection law) that cannot lawfully be excluded.`,
    ],
  },
  {
    id: "disclaimers",
    title: "14. Disclaimers",
    paragraphs: [
      `To the extent permitted by law, the Service is provided "as is" and "as available" without warranties of any kind, whether express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.`,
      `We do not warrant that recordings will be error-free, that exports will meet any particular quality standard on every device, or that the Service will be uninterrupted or secure.`,
      `The disclaimers in this section do not apply to consumers where prohibited by the ACL or other mandatory law.`,
    ],
  },
  {
    id: "liability",
    title: "15. Limitation of liability",
    paragraphs: [
      `To the maximum extent permitted by law, we and our suppliers will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, goodwill, or business opportunity, arising from or related to the Service.`,
      `To the maximum extent permitted by law, our total liability for any claim arising out of or relating to the Service or these Terms will not exceed the greater of (a) the amount you paid us for the Service in the twelve (12) months before the event giving rise to the claim, or (b) USD $50.`,
      `These limits do not apply where prohibited by law, including liability that cannot be limited under the ACL for consumer guarantees. Where the ACL applies and permits liability to be limited for a non-major failure, our liability is limited (at our option) to resupplying the Service or paying the cost of having the Service supplied again.`,
    ],
  },
  {
    id: "indemnity",
    title: "16. Indemnification",
    paragraphs: [
      `To the extent permitted by law and except where prohibited for consumers under mandatory law, you will defend, indemnify, and hold harmless ${OPERATOR_NAME} and its operators, affiliates, and suppliers from any claims, damages, losses, and expenses (including reasonable legal fees) arising from your use of the Service, your recordings or exports, your violation of these Terms, or your violation of any law or third-party right.`,
    ],
  },
  {
    id: "termination",
    title: "17. Suspension and termination",
    paragraphs: [
      `We may suspend or terminate your access to the Service if we reasonably believe you violated these Terms, pose a security risk, or if we discontinue the Service. Where reasonable, we will give you notice before termination except for serious breaches or legal requirements.`,
      `You may stop using the Service at any time. Because Pro is a one-time purchase, there is no subscription to cancel; uninstalling the desktop app does not affect your purchased license, which remains tied to your account.`,
      `Sections that by their nature should survive termination (including payment obligations accrued, ownership, disclaimers, limitations of liability, and indemnification) will survive, subject to mandatory law.`,
    ],
  },
  {
    id: "changes",
    title: "18. Changes to these Terms",
    paragraphs: [
      `We may update these Terms from time to time. We will post the revised Terms on ${SITE_URL}/terms and update the effective date. For material changes, we will provide reasonable notice through the Service or by email if we have your address.`,
      `Continued use after changes become effective constitutes acceptance of the revised Terms where permitted by law. If you do not agree, stop using the Service before the changes take effect.`,
    ],
  },
  {
    id: "law",
    title: "19. Governing law and disputes",
    paragraphs: [
      `${SERVICE_NAME} is operated from ${OPERATOR_LOCATION}. These Terms are governed by the laws of Western Australia and the Commonwealth of Australia, without regard to conflict-of-law rules that would apply another jurisdiction's laws.`,
      `If you access the Service from outside Australia, you are responsible for complying with local laws that apply to you. Nothing in these Terms replaces or limits rights and remedies that cannot be excluded under mandatory consumer protection or other non-waivable laws in your country or state of residence.`,
      `Subject to mandatory law, the courts of Western Australia have non-exclusive jurisdiction over disputes relating to these Terms or the Service, and you submit to the jurisdiction of those courts. We may also bring proceedings in the courts of your country or state of residence where permitted by law.`,
      `Before starting formal proceedings, we encourage you to contact ${LEGAL_CONTACT_EMAIL} so we can try to resolve the issue in good faith.`,
    ],
  },
  {
    id: "contact",
    title: "20. Contact",
    paragraphs: [`Questions about these Terms: ${LEGAL_CONTACT_EMAIL}.`],
  },
];
