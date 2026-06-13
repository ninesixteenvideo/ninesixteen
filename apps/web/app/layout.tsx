import type { Metadata, Viewport } from "next";
import "@ninesixteen/brand/theme.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "ninesixteen.video — record & stream, framed by hand",
  description:
    "A lightweight desktop recorder & live streamer with a tactile two-handed framing viewport. Capture in 16×9 or 9×16 and shift the frame on the fly with your other hand.",
  applicationName: "ninesixteen.video",
  keywords: [
    "screen recorder",
    "live streaming",
    "vertical video",
    "9x16",
    "16x9",
    "content creators",
    "tauri app",
  ],
  openGraph: {
    title: "ninesixteen.video",
    description:
      "Record & stream your desktop. Frame it with your other hand. 16×9 or 9×16, panned, zoomed and rotated live.",
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
    <html lang="en">
      <body className="ns-grain min-h-screen">
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
