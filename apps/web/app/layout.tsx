import type { Metadata, Viewport } from "next";
import { Faster_One, IBM_Plex_Mono, Inter, Tourney } from "next/font/google";
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

const tourney = Tourney({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-tourney",
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
    "Record your screen in true 9×16 — no cropping in post. Frame with your cursor, zoom with Alt + scroll, and capture short-form footage ready for CapCut. Free to try, $49 one-time to export.",
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
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ibmPlexMono.variable} ${tourney.variable} ${fasterOne.variable}`}
    >
      <body className="ns-grain min-h-screen font-body antialiased">
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
