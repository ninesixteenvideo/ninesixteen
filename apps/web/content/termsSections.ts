import type { LegalSection } from "@/lib/legalMeta";
import { LEGAL_CONTACT_EMAIL, SERVICE_NAME, SITE_URL } from "@/lib/legalMeta";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    paragraphs: [
      `These Terms of Use ("Terms") govern your access to and use of the ${SERVICE_NAME} website at ${SITE_URL}, our Windows desktop application, and any related services we provide (collectively, the "Service").`,
      `By downloading, installing, accessing, or using the Service, you agree to these Terms. If you do not agree, do not use the Service.`,
      `If you use the Service on behalf of an organization, you represent that you have authority to bind that organization, and "you" includes that organization.`,
    ],
  },
  {
    id: "eligibility",
    title: "2. Eligibility",
    paragraphs: [
      `You must be at least 13 years old to use the Service. If you are under 18, you may use the Service only with the involvement and consent of a parent or legal guardian.`,
      `You may not use the Service if you are barred from doing so under applicable law or if we have previously suspended or terminated your access.`,
    ],
  },
  {
    id: "service",
    title: "3. Description of the Service",
    paragraphs: [
      `${SERVICE_NAME} is a vertical desktop capture tool for Windows. The Service lets you frame a 9×16 region of your screen, record video (and optional audio), preview recordings inside the app, and—when subscribed to Pro—export decrypted MP4 files locally or to Google Drive.`,
      `The desktop app also exposes a virtual camera device named "${SERVICE_NAME}" that other applications may use as a video source while the app is running.`,
      `We may update, change, or discontinue features at any time. We do not guarantee uninterrupted or error-free operation.`,
    ],
  },
  {
    id: "accounts",
    title: "4. Accounts and authentication",
    paragraphs: [
      `You may use parts of the desktop app without an account. Creating an account lets you sync Pro entitlements between the web app and desktop app, manage billing, and sign in across devices.`,
      `You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Notify us promptly at ${LEGAL_CONTACT_EMAIL} if you suspect unauthorized access.`,
      `You agree to provide accurate account information and to keep it up to date.`,
    ],
  },
  {
    id: "subscriptions",
    title: "5. Subscriptions, billing, and refunds",
    paragraphs: [
      `Pro is a paid subscription that unlocks export features and related Pro benefits described on our pricing page. Current list prices are $12 per month or $39 per year, billed through Stripe. Prices may change; we will give reasonable notice before new prices apply to an existing subscription.`,
      `Payments are processed by Stripe. By subscribing, you also agree to Stripe's terms and privacy practices. We do not store full payment card numbers on our servers.`,
      `Subscriptions renew automatically until cancelled. You can cancel through the Stripe customer portal linked from your account dashboard. If you cancel, you generally retain Pro access until the end of the current billing period, after which your account reverts to the free tier unless stated otherwise at checkout.`,
      `Except where required by law, fees are non-refundable. Chargebacks or payment disputes may result in suspension of Pro access.`,
    ],
  },
  {
    id: "free-pro",
    title: "6. Free tier and Pro features",
    paragraphs: [
      `The free tier lets you record and preview encrypted recordings stored locally on your device. Exporting decrypted MP4 files requires an active Pro subscription unless we explicitly state otherwise in the app.`,
      `Pro features, pricing, and limits may change. Material reductions to Pro features will not apply retroactively to a paid period you have already purchased without notice.`,
    ],
    bullets: [
      "Free: local recording, in-app preview, virtual camera (while the app is running), and core capture settings.",
      "Pro: MP4 export to your computer (for example, Documents/Videos) and optional export to your Google Drive, plus other Pro benefits we describe in the product.",
    ],
  },
  {
    id: "recordings",
    title: "7. Your recordings and local data",
    paragraphs: [
      `Recordings are captured and stored on your computer by default. Free-tier recordings are stored in an encrypted format intended to prevent casual copying; Pro export decrypts them to standard MP4 files you choose to save.`,
      `You retain ownership of content you record, subject to third-party rights. You are solely responsible for what you capture, including obtaining any consents required by law when recording other people, confidential information, copyrighted material, or sensitive data visible on your screen or audible in your audio.`,
      `We do not routinely access, host, or review your recordings on our servers. Back up exports you care about; we are not responsible for loss of local files due to device failure, uninstallation, or user error.`,
    ],
  },
  {
    id: "exports",
    title: "8. Export and third-party integrations",
    paragraphs: [
      `Local export saves files to a folder on your device that you can open in other apps. Google Drive export requires you to authorize Google separately; files are uploaded directly to your Google account using the permissions you grant.`,
      `Third-party services (including Google, Stripe, and your operating system) have their own terms and policies. We are not responsible for third-party outages, data handling, or account actions taken by those providers.`,
    ],
  },
  {
    id: "virtual-camera",
    title: "9. Virtual camera",
    paragraphs: [
      `The virtual camera feature makes your live framed output available to other applications. You are responsible for how you use that output and for complying with the policies of any platform or app that receives it.`,
      `Some applications cache camera lists; you may need to restart them after installing or registering the virtual camera driver. Administrator setup steps described in the app may be required on Windows.`,
    ],
  },
  {
    id: "acceptable-use",
    title: "10. Acceptable use",
    paragraphs: [
      `You agree not to misuse the Service. Without limiting other restrictions, you may not:`,
    ],
    bullets: [
      "Use the Service for unlawful, fraudulent, harassing, or abusive purposes.",
      "Record or distribute content in violation of intellectual property, privacy, publicity, or other rights.",
      "Attempt to reverse engineer, decompile, or circumvent subscription, export, or encryption mechanisms except where such restriction is prohibited by law.",
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
      `If you send suggestions, ideas, or feedback, you grant us a perpetual, irrevocable, worldwide, royalty-free license to use them without obligation to you. Do not send confidential or proprietary information you expect to be kept secret unless we agree in writing.`,
    ],
  },
  {
    id: "disclaimers",
    title: "13. Disclaimers",
    paragraphs: [
      `THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.`,
      `We do not warrant that recordings will be error-free, that exports will meet any particular quality standard on every device, that the virtual camera will be compatible with every application, or that the Service will be uninterrupted or secure.`,
      `Some jurisdictions do not allow certain warranty exclusions; in those cases, our disclaimers apply to the fullest extent permitted by law.`,
    ],
  },
  {
    id: "liability",
    title: "14. Limitation of liability",
    paragraphs: [
      `TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS OPPORTUNITY, ARISING FROM OR RELATED TO THE SERVICE.`,
      `TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) US $50.`,
      `These limits apply even if a remedy fails of its essential purpose. Some jurisdictions do not allow certain liability limitations; in those cases, our liability is limited to the fullest extent permitted by law.`,
    ],
  },
  {
    id: "indemnity",
    title: "15. Indemnification",
    paragraphs: [
      `You will defend, indemnify, and hold harmless ${SERVICE_NAME} and its operators, affiliates, and suppliers from any claims, damages, losses, and expenses (including reasonable attorneys' fees) arising from your use of the Service, your recordings or exports, your violation of these Terms, or your violation of any law or third-party right.`,
    ],
  },
  {
    id: "termination",
    title: "16. Suspension and termination",
    paragraphs: [
      `We may suspend or terminate your access to the Service at any time if we reasonably believe you violated these Terms, pose a security risk, or if we discontinue the Service.`,
      `You may stop using the Service at any time. Uninstalling the desktop app does not automatically cancel a Pro subscription—you must cancel billing through Stripe.`,
      `Sections that by their nature should survive termination (including payment obligations accrued, disclaimers, limitations of liability, and indemnification) will survive.`,
    ],
  },
  {
    id: "changes",
    title: "17. Changes to these Terms",
    paragraphs: [
      `We may update these Terms from time to time. We will post the revised Terms on ${SITE_URL}/terms and update the effective date. Material changes may also be communicated through the Service or by email if we have your address.`,
      `Continued use after changes become effective constitutes acceptance of the revised Terms. If you do not agree, stop using the Service and cancel any subscription.`,
    ],
  },
  {
    id: "law",
    title: "18. Governing law and disputes",
    paragraphs: [
      `These Terms are governed by the laws of the United States and the State of Delaware, without regard to conflict-of-law rules, except where mandatory local consumer protection law applies in your country of residence.`,
      `Except where prohibited, you agree that exclusive jurisdiction for disputes relating to these Terms or the Service lies in the state or federal courts located in Delaware, and you consent to personal jurisdiction there.`,
      `Nothing in these Terms limits any non-waivable consumer rights you may have under applicable law.`,
    ],
  },
  {
    id: "contact",
    title: "19. Contact",
    paragraphs: [
      `Questions about these Terms: ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
];
