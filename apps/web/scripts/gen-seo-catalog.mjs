#!/usr/bin/env node
/**
 * Generates content/landingPageCatalog.ts — 95 SEO landing page definitions.
 * Run: node apps/web/scripts/gen-seo-catalog.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../content/landingPageCatalog.ts");

/** @type {Array<{ slug: string; linkLabel: string; primaryKeyword: string; kicker: string; category: string; aspect: "portrait"|"landscape"|"both"; audience?: string }>} */
const entries = [];

function add(slug, linkLabel, primaryKeyword, kicker, category, aspect, audience) {
  entries.push({ slug, linkLabel, primaryKeyword, kicker, category, aspect, audience });
}

// Platforms & social (portrait-heavy)
const platforms = [
  ["instagram-reels-screen-recorder", "Instagram Reels", "Instagram Reels screen recorder", "Instagram Reels", "platform", "portrait"],
  ["instagram-stories-screen-recorder", "Instagram Stories", "Instagram Stories screen recorder", "Instagram Stories", "platform", "portrait"],
  ["facebook-reels-screen-recorder", "Facebook Reels", "Facebook Reels screen recorder", "Facebook Reels", "platform", "portrait"],
  ["snapchat-screen-recorder", "Snapchat", "Snapchat screen recorder", "Snapchat", "platform", "portrait"],
  ["pinterest-video-screen-recorder", "Pinterest video", "Pinterest video screen recorder", "Pinterest", "platform", "portrait"],
  ["threads-screen-recorder", "Threads", "Threads screen recorder", "Threads", "platform", "portrait"],
  ["linkedin-vertical-video-recorder", "LinkedIn vertical video", "LinkedIn vertical video recorder", "LinkedIn", "platform", "portrait"],
  ["twitch-clips-screen-recorder", "Twitch clips", "Twitch clips screen recorder", "Twitch clips", "platform", "both"],
  ["kick-screen-recorder", "Kick", "Kick screen recorder", "Kick", "platform", "both"],
  ["rumble-screen-recorder", "Rumble", "Rumble screen recorder", "Rumble", "platform", "both"],
  ["x-twitter-video-recorder", "X / Twitter video", "X video screen recorder", "X · Twitter", "platform", "both"],
  ["bluesky-video-recorder", "Bluesky video", "Bluesky screen recorder", "Bluesky", "platform", "both"],
  ["whatsapp-status-recorder", "WhatsApp Status", "WhatsApp Status screen recorder", "WhatsApp", "platform", "portrait"],
  ["telegram-channel-recorder", "Telegram channel", "Telegram screen recorder", "Telegram", "platform", "both"],
  ["discord-clips-recorder", "Discord clips", "Discord screen recorder", "Discord", "platform", "both"],
];
for (const [slug, label, kw, kicker, cat, aspect] of platforms) {
  add(slug, label, kw, kicker, cat, aspect);
}

// Tutorials & education
const tutorials = [
  ["coding-tutorial-screen-recorder", "Coding tutorials", "coding tutorial screen recorder", "Coding tutorials", "tutorial", "both", "developers"],
  ["programming-tutorial-recorder", "Programming tutorials", "programming tutorial screen recorder", "Programming", "tutorial", "both", "developers"],
  ["python-tutorial-screen-recorder", "Python tutorials", "Python tutorial screen recorder", "Python", "tutorial", "both", "Python creators"],
  ["javascript-tutorial-recorder", "JavaScript tutorials", "JavaScript tutorial screen recorder", "JavaScript", "tutorial", "both", "web developers"],
  ["react-tutorial-screen-recorder", "React tutorials", "React tutorial screen recorder", "React", "tutorial", "both", "React developers"],
  ["nextjs-tutorial-recorder", "Next.js tutorials", "Next.js tutorial screen recorder", "Next.js", "tutorial", "both", "Next.js developers"],
  ["web-dev-tutorial-recorder", "Web dev tutorials", "web development screen recorder", "Web development", "tutorial", "both", "web creators"],
  ["figma-tutorial-screen-recorder", "Figma tutorials", "Figma tutorial screen recorder", "Figma", "tutorial", "both", "designers"],
  ["photoshop-tutorial-recorder", "Photoshop tutorials", "Photoshop tutorial screen recorder", "Photoshop", "tutorial", "landscape", "designers"],
  ["blender-tutorial-recorder", "Blender tutorials", "Blender tutorial screen recorder", "Blender", "tutorial", "landscape", "3D artists"],
  ["unity-tutorial-recorder", "Unity tutorials", "Unity tutorial screen recorder", "Unity", "tutorial", "landscape", "game developers"],
  ["game-dev-screen-recorder", "Game dev", "game development screen recorder", "Game development", "tutorial", "both", "indie devs"],
  ["udemy-course-screen-recorder", "Udemy courses", "Udemy course screen recorder", "Udemy", "tutorial", "landscape", "course creators"],
  ["skillshare-tutorial-recorder", "Skillshare", "Skillshare tutorial screen recorder", "Skillshare", "tutorial", "landscape", "instructors"],
  ["online-course-recorder", "Online courses", "online course screen recorder", "Online courses", "tutorial", "landscape", "educators"],
];

for (const row of tutorials) {
  add(...row);
}

// SaaS, product, business
const business = [
  ["indie-hacker-demo-recorder", "Indie hackers", "indie hacker demo recorder", "Indie hackers", "business", "both", "solo founders"],
  ["startup-product-demo-recorder", "Startup demos", "startup product demo recorder", "Startups", "business", "both", "founders"],
  ["b2b-saas-demo-recorder", "B2B SaaS demos", "B2B SaaS demo recorder", "B2B SaaS", "business", "landscape", "sales teams"],
  ["app-walkthrough-recorder", "App walkthroughs", "app walkthrough screen recorder", "App walkthroughs", "business", "both", "product marketers"],
  ["software-demo-video-recorder", "Software demos", "software demo screen recorder", "Software demos", "business", "landscape", "SaaS teams"],
  ["customer-onboarding-video-recorder", "Customer onboarding", "customer onboarding video recorder", "Onboarding", "business", "landscape", "CS teams"],
  ["feature-announcement-recorder", "Feature launches", "feature announcement screen recorder", "Feature launches", "business", "both", "product teams"],
  ["changelog-video-recorder", "Changelog videos", "changelog video screen recorder", "Changelog", "business", "both", "dev rel teams"],
  ["api-demo-screen-recorder", "API demos", "API demo screen recorder", "API demos", "business", "landscape", "developer advocates"],
  ["no-code-app-demo-recorder", "No-code apps", "no-code app demo recorder", "No-code", "business", "both", "makers"],
  ["product-hunt-launch-recorder", "Product Hunt launches", "Product Hunt launch video recorder", "Product Hunt", "business", "both", "launching founders"],
  ["agency-client-demo-recorder", "Agency client demos", "agency client demo recorder", "Agencies", "business", "landscape", "agencies"],
  ["consultant-walkthrough-recorder", "Consultants", "consultant walkthrough screen recorder", "Consultants", "business", "landscape", "consultants"],
  ["webinar-screen-recorder", "Webinars", "webinar screen recorder", "Webinars", "business", "landscape", "hosts"],
  ["remote-work-demo-recorder", "Remote work demos", "remote work demo screen recorder", "Remote work", "business", "landscape", "remote teams"],
];

for (const row of business) {
  add(...row);
}

// Alternatives & comparisons
const alternatives = [
  ["obs-alternative-vertical-recorder", "OBS alternative (vertical)", "OBS alternative for vertical video", "OBS alternative", "compare", "portrait"],
  ["loom-alternative-screen-recorder", "Loom alternative", "Loom alternative screen recorder", "Loom alternative", "compare", "both"],
  ["camtasia-alternative-windows", "Camtasia alternative", "Camtasia alternative for Windows", "Camtasia alternative", "compare", "landscape"],
  ["screenflow-alternative-windows", "ScreenFlow alternative", "ScreenFlow alternative Windows", "ScreenFlow alternative", "compare", "landscape"],
  ["sharex-alternative-vertical", "ShareX alternative", "ShareX alternative vertical recorder", "ShareX alternative", "compare", "portrait"],
  ["bandicam-alternative-recorder", "Bandicam alternative", "Bandicam alternative screen recorder", "Bandicam alternative", "compare", "both"],
  ["screencastify-alternative-windows", "Screencastify alternative", "Screencastify alternative Windows", "Screencastify alternative", "compare", "both"],
  ["clipchamp-alternative-recorder", "Clipchamp alternative", "Clipchamp alternative screen recorder", "Clipchamp alternative", "compare", "both"],
  ["capcut-alternative-screen-recorder", "CapCut workflow", "screen recorder without CapCut crop", "Skip CapCut crop", "compare", "portrait"],
  ["snipping-tool-alternative-recorder", "Snipping Tool alternative", "Snipping Tool alternative video recorder", "Snipping Tool alternative", "compare", "both"],
  ["xbox-game-bar-alternative-recorder", "Xbox Game Bar alternative", "Xbox Game Bar alternative recorder", "Game Bar alternative", "compare", "both"],
  ["streamlabs-alternative-recorder", "Streamlabs alternative", "Streamlabs alternative screen recorder", "Streamlabs alternative", "compare", "both"],
];

for (const row of alternatives) {
  add(...row);
}

// Apps & tools
const apps = [
  ["notion-tutorial-screen-recorder", "Notion tutorials", "Notion tutorial screen recorder", "Notion", "app", "both", "Notion creators"],
  ["excel-tutorial-screen-recorder", "Excel tutorials", "Excel tutorial screen recorder", "Excel", "app", "landscape", "spreadsheet creators"],
  ["powerpoint-screen-recorder", "PowerPoint", "PowerPoint screen recorder", "PowerPoint", "app", "landscape", "presenters"],
  ["google-sheets-tutorial-recorder", "Google Sheets", "Google Sheets tutorial recorder", "Google Sheets", "app", "landscape", "trainers"],
  ["vscode-screen-recorder", "VS Code", "VS Code screen recorder", "VS Code", "app", "both", "developers"],
  ["chrome-browser-screen-recorder", "Chrome browser", "Chrome browser screen recorder", "Chrome", "app", "both", "tutorial makers"],
  ["windows-app-demo-recorder", "Windows apps", "Windows app demo recorder", "Windows apps", "app", "both", "software creators"],
  ["canva-tutorial-recorder", "Canva tutorials", "Canva tutorial screen recorder", "Canva", "app", "both", "designers"],
  ["slack-demo-recorder", "Slack demos", "Slack demo screen recorder", "Slack", "app", "landscape", "teams"],
  ["stripe-dashboard-demo-recorder", "Stripe dashboard", "Stripe dashboard demo recorder", "Stripe", "app", "landscape", "fintech demos"],
  ["airtable-tutorial-recorder", "Airtable tutorials", "Airtable tutorial screen recorder", "Airtable", "app", "landscape", "ops teams"],
  ["hubspot-demo-recorder", "HubSpot demos", "HubSpot demo screen recorder", "HubSpot", "app", "landscape", "marketing teams"],
];

for (const row of apps) {
  add(...row);
}

// Industries & niches
const niches = [
  ["real-estate-screen-recorder", "Real estate", "real estate screen recorder", "Real estate", "niche", "both", "agents"],
  ["finance-app-demo-recorder", "Finance apps", "finance app demo recorder", "Finance apps", "niche", "landscape", "fintech"],
  ["crypto-trading-screen-recorder", "Crypto trading", "crypto trading screen recorder", "Crypto trading", "niche", "both", "traders"],
  ["ecommerce-demo-recorder", "E-commerce demos", "ecommerce demo screen recorder", "E-commerce", "niche", "both", "store owners"],
  ["shopify-tutorial-recorder", "Shopify tutorials", "Shopify tutorial screen recorder", "Shopify", "niche", "both", "merchants"],
  ["fitness-app-demo-recorder", "Fitness apps", "fitness app demo recorder", "Fitness apps", "niche", "portrait", "coaches"],
  ["education-course-recorder", "Education", "education screen recorder", "Education", "niche", "landscape", "teachers"],
  ["online-coaching-screen-recorder", "Online coaching", "online coaching screen recorder", "Online coaching", "niche", "portrait", "coaches"],
  ["medical-software-demo-recorder", "Medical software", "medical software demo recorder", "Medical software", "niche", "landscape", "healthtech"],
  ["legal-tech-demo-recorder", "Legal tech", "legal tech demo screen recorder", "Legal tech", "niche", "landscape", "legal SaaS"],
  ["affiliate-marketing-screen-recorder", "Affiliate marketing", "affiliate marketing screen recorder", "Affiliate marketing", "niche", "portrait", "affiliates"],
  ["social-media-manager-recorder", "Social media managers", "social media manager screen recorder", "SMM", "niche", "portrait", "social managers"],
];

for (const row of niches) {
  add(...row);
}

// Creators & mobile
const creators = [
  ["mobile-app-demo-recorder", "Mobile app demos", "mobile app demo screen recorder", "Mobile apps", "creator", "portrait", "app marketers"],
  ["ios-app-demo-windows-recorder", "iOS app demos", "iOS app demo recorder Windows", "iOS demos", "creator", "portrait", "app founders"],
  ["android-app-emulator-recorder", "Android emulator", "Android emulator screen recorder", "Android emulator", "creator", "portrait", "Android devs"],
  ["ux-design-walkthrough-recorder", "UX walkthroughs", "UX design walkthrough recorder", "UX design", "creator", "both", "UX designers"],
  ["ui-design-screen-recorder", "UI design", "UI design screen recorder", "UI design", "creator", "both", "UI designers"],
  ["content-creator-screen-recorder", "Content creators", "content creator screen recorder", "Content creators", "creator", "portrait", "creators"],
  ["influencer-tutorial-recorder", "Influencer tutorials", "influencer tutorial screen recorder", "Influencers", "creator", "portrait", "influencers"],
  ["faceless-youtube-recorder", "Faceless YouTube", "faceless YouTube screen recorder", "Faceless YouTube", "creator", "both", "YouTubers"],
  ["youtube-tutorials-recorder", "YouTube tutorials", "YouTube tutorial screen recorder", "YouTube tutorials", "creator", "landscape", "YouTubers"],
  ["podcast-video-recorder", "Podcast video", "podcast video screen recorder", "Podcast video", "creator", "landscape", "podcasters"],
];

for (const row of creators) {
  add(...row);
}

// Technical / workflow keywords
const workflow = [
  ["vertical-video-without-crop", "No crop vertical", "vertical video without cropping", "No crop", "workflow", "portrait"],
  ["no-crop-screen-recorder", "No crop recorder", "no crop screen recorder", "No crop", "workflow", "both"],
  ["native-aspect-screen-recorder", "Native aspect ratio", "native aspect ratio screen recorder", "Native aspect", "workflow", "both"],
  ["cursor-framing-screen-recorder", "Cursor framing", "cursor framing screen recorder", "Cursor framing", "workflow", "both"],
  ["rule-of-thirds-screen-recorder", "Rule of thirds", "rule of thirds screen recorder", "Rule of thirds", "workflow", "both"],
  ["windows-11-vertical-recorder", "Windows 11 vertical", "Windows 11 vertical screen recorder", "Windows 11", "workflow", "portrait"],
  ["windows-10-vertical-recorder", "Windows 10 vertical", "Windows 10 vertical screen recorder", "Windows 10", "workflow", "portrait"],
  ["low-cpu-screen-recorder", "Low CPU", "low CPU screen recorder", "Low CPU", "workflow", "both"],
  ["lightweight-screen-recorder-windows", "Lightweight Windows", "lightweight screen recorder Windows", "Lightweight", "workflow", "both"],
  ["encrypted-local-screen-recorder", "Encrypted local", "encrypted local screen recorder", "Local-first", "workflow", "both"],
  ["virtual-camera-screen-recorder", "Virtual camera", "virtual camera screen recorder", "Virtual camera", "workflow", "both"],
  ["mouse-click-audio-recorder", "Mouse click audio", "screen recorder with mouse click audio", "Click audio", "workflow", "both"],
];

for (const row of workflow) {
  add(...row);
}

// Gaming
const gaming = [
  ["minecraft-tutorial-recorder", "Minecraft tutorials", "Minecraft tutorial screen recorder", "Minecraft", "gaming", "both", "Minecraft creators"],
  ["roblox-tutorial-recorder", "Roblox tutorials", "Roblox tutorial screen recorder", "Roblox", "gaming", "portrait", "Roblox creators"],
  ["steam-game-recorder", "Steam games", "Steam game screen recorder", "Steam", "gaming", "landscape", "PC gamers"],
  ["esports-highlight-recorder", "Esports highlights", "esports highlight screen recorder", "Esports", "gaming", "landscape", "esports editors"],
  ["speedrun-screen-recorder", "Speedruns", "speedrun screen recorder", "Speedruns", "gaming", "landscape", "speedrunners"],
];

for (const row of gaming) {
  add(...row);
}

// AI & automation
const ai = [
  ["ai-tool-demo-recorder", "AI tool demos", "AI tool demo screen recorder", "AI tools", "ai", "both", "AI builders"],
  ["chatgpt-workflow-recorder", "ChatGPT workflows", "ChatGPT workflow screen recorder", "ChatGPT", "ai", "both", "AI users"],
  ["automation-demo-recorder", "Automation demos", "automation demo screen recorder", "Automation", "ai", "landscape", "automation creators"],
  ["zapier-tutorial-recorder", "Zapier tutorials", "Zapier tutorial screen recorder", "Zapier", "ai", "landscape", "no-code users"],
  ["mcp-server-demo-recorder", "MCP server demos", "MCP server demo screen recorder", "MCP servers", "ai", "landscape", "dev tool makers"],
];

for (const row of ai) {
  add(...row);
}

// Extra language / intent long-tail
const longtail = [
  ["record-screen-for-reels", "Record for Reels", "record screen for Instagram Reels", "Reels capture", "longtail", "portrait"],
  ["record-screen-for-shorts", "Record for Shorts", "record screen for YouTube Shorts", "Shorts capture", "longtail", "portrait"],
  ["record-screen-for-tiktok", "Record for TikTok", "record screen for TikTok", "TikTok capture", "longtail", "portrait"],
  ["portrait-monitor-recorder", "Portrait monitor", "portrait monitor screen recorder", "Portrait monitor", "longtail", "portrait"],
  ["9x16-video-recorder-windows", "9×16 on Windows", "9x16 video recorder Windows", "9×16 Windows", "longtail", "portrait"],
  ["16x9-demo-recorder-windows", "16×9 demos", "16x9 demo recorder Windows", "16×9 Windows", "longtail", "landscape"],
  ["screen-recorder-for-creators", "For creators", "screen recorder for content creators", "Creators", "longtail", "both"],
  ["screen-recorder-for-founders", "For founders", "screen recorder for founders", "Founders", "longtail", "both"],
  ["one-time-purchase-screen-recorder", "One-time purchase", "one time purchase screen recorder", "One-time Pro", "longtail", "both"],
  ["no-subscription-screen-recorder", "No subscription", "screen recorder no subscription", "No subscription", "longtail", "both"],
];

for (const row of longtail) {
  add(...row);
}

const FINAL = entries.slice(0, 95);

if (FINAL.length !== 95) {
  console.error(`Expected at least 95 catalog entries, got ${entries.length} raw / ${FINAL.length} final`);
  process.exit(1);
}

const body = `import type { LandingCatalogEntry } from "./buildLandingPage";

/** Auto-generated SEO landing page catalog (${FINAL.length} pages). Regenerate: node apps/web/scripts/gen-seo-catalog.mjs */
export const SEO_LANDING_CATALOG: readonly LandingCatalogEntry[] = ${JSON.stringify(FINAL, null, 2)} as const;
`;

writeFileSync(outPath, body, "utf8");
console.log(`Wrote ${FINAL.length} entries to ${outPath}`);

// Update llms.txt SEO page list
const llmsPath = join(__dirname, "../public/llms.txt");
const coreSlugs = new Set([
  "vertical-screen-recorder",
  "landscape-screen-recorder",
  "tiktok-screen-recorder",
  "youtube-shorts-screen-recorder",
  "saas-demo-recorder",
]);
const allPages = [
  ...FINAL.filter((e) => !coreSlugs.has(e.slug)),
].sort((a, b) => a.linkLabel.localeCompare(b.linkLabel));

// Re-read core labels from hardcoded map for flagship pages
const CORE_LABELS = {
  "vertical-screen-recorder": "Vertical 9×16 screen recorder",
  "landscape-screen-recorder": "Landscape 16×9 screen recorder",
  "tiktok-screen-recorder": "TikTok screen recorder",
  "youtube-shorts-screen-recorder": "YouTube Shorts screen recorder",
  "saas-demo-recorder": "SaaS demo recorder",
};

const pageLines = [
  ...Object.entries(CORE_LABELS).map(
    ([slug, label]) => `- [${label}](https://ninesixteen.video/${slug})`,
  ),
  ...FINAL.filter((e) => !coreSlugs.has(e.slug))
    .sort((a, b) => a.linkLabel.localeCompare(b.linkLabel))
    .map((e) => `- [${e.linkLabel}](https://ninesixteen.video/${e.slug})`),
  "- [vs OBS comparison](https://ninesixteen.video/compare/obs)",
];

const llms = readFileSync(llmsPath, "utf8");
const updated = llms.replace(
  /## Use-case pages[\s\S]*?(?=## Key facts)/,
  `## Use-case pages (${pageLines.length} guides)\n\n${pageLines.join("\n")}\n\n`,
);
writeFileSync(llmsPath, updated, "utf8");
console.log(`Updated llms.txt with ${pageLines.length} guide links`);
