import { DownloadPageClient } from "@/components/DownloadPageClient";
import { JsonLd } from "@/components/JsonLd";
import { softwareApplicationJsonLd, webPageJsonLd } from "@/lib/seo/jsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  title: "Download — Windows 9×16 & 16×9 screen recorder",
  description:
    "Download ninesixteen.video for Windows 10/11. Free native 9×16 and 16×9 screen recording, cursor framing, encrypted local preview. Pro export $49 one-time.",
  path: "/download",
  keywords: [
    "download ninesixteen",
    "windows screen recorder download",
    "vertical screen recorder installer",
  ],
});

export default function DownloadPage() {
  return (
    <>
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          webPageJsonLd({
            title: "Download",
            description: "Download ninesixteen.video for Windows",
            path: "/download",
          }),
        ]}
      />
      <DownloadPageClient />
    </>
  );
}
