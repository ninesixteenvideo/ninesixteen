import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bungee, Faster_One, IBM_Plex_Mono, Inter } from "next/font/google";
import "@ninesixteen/brand/theme.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const bungee = Bungee({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bungee",
  display: "swap",
});

const fasterOne = Faster_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-faster-one",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ninesixteen.video — the vertical screen recorder for Windows",
  description:
    "Record your screen in true 9×16 — no cropping in post. Frame with your cursor, zoom with Alt + scroll, and capture short-form footage ready for CapCut. Free to try, $49 one-time purchase.",
  applicationName: "ninesixteen.video",
  keywords: [
    "vertical screen recorder",
    "9x16 screen recorder",
    "tiktok screen recorder",
    "reels screen recorder",
    "youtube shorts recorder",
    "vertical video",
    "short form content",
    "saas demo recorder",
    "build in public",
    "windows screen recorder",
  ],
  openGraph: {
    title: "ninesixteen.video — the vertical screen recorder for Windows",
    description:
      "Record your screen in true 9×16 for Shorts, Reels, and TikTok — no cropping later. Free to try, $49 one-time to export.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#1b1a18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const xPixelId = process.env.NEXT_PUBLIC_X_PIXEL_ID?.trim();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${ibmPlexMono.variable} ${bungee.variable} ${fasterOne.variable}`}
    >
      <body className="ns-grain min-h-screen font-body antialiased">
        {xPixelId ? (
          <Script id="x-conversion-pixel" strategy="afterInteractive">
            {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','${xPixelId}');`}
          </Script>
        ) : null}
        <AuthProvider>
          <div className="relative z-10 flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
