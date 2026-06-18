import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: "ninesixteen",
    description: SITE.shortDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#121110",
    lang: "en",
    categories: ["productivity", "utilities", "video"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
