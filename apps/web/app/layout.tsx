import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bungee, Faster_One, IBM_Plex_Mono, Inter } from "next/font/google";
import "@ninesixteen/brand/theme.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteTvOverlay } from "@/components/SiteTvOverlay";
import { JsonLd } from "@/components/JsonLd";
import { organizationJsonLd, softwareApplicationJsonLd, webSiteJsonLd } from "@/lib/seo/jsonLd";
import { rootMetadata } from "@/lib/seo/metadata";

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

export const metadata: Metadata = rootMetadata;

export const viewport: Viewport = {
  themeColor: "#121110",
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
        <JsonLd
          data={[organizationJsonLd(), webSiteJsonLd(), softwareApplicationJsonLd()]}
        />
        {xPixelId ? (
          <Script id="x-conversion-pixel" strategy="afterInteractive">
            {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','${xPixelId}');`}
          </Script>
        ) : null}
        <AuthProvider>
          <SiteTvOverlay />
          <div className="site-chrome relative z-10 flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
