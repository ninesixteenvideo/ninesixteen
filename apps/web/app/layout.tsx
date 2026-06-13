import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
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

export const metadata: Metadata = {
  title: "ninesixteen.video — vertical desktop capture for creators",
  description:
    "Record your desktop in crisp 9×16. Frame with your cursor, zoom with Alt + scroll, preview locally, export MP4 with Pro, and use ninesixteen.video as a camera in other apps.",
  applicationName: "ninesixteen.video",
  keywords: [
    "screen recorder",
    "vertical video",
    "9x16",
    "short form",
    "content creators",
    "windows app",
  ],
  openGraph: {
    title: "ninesixteen.video",
    description:
      "Vertical desktop capture for Shorts, Reels, and TikTok. Frame in five seconds. Record locally, export with Pro, or use as a virtual camera in other apps.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f3ef",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable}`}>
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
