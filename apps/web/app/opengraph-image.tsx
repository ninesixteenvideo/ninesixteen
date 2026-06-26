import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#121110",
          color: "#f5f2ed",
          padding: "64px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8a847c",
            }}
          >
            Windows screen recorder
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            Native 9×16 &amp; 16×9 capture
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: "#c8c2b8",
              maxWidth: 820,
              lineHeight: 1.4,
            }}
          >
            No crop in post · Game mode · cursor framing · $49 one-time
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 42, fontWeight: 700 }}>
            <span style={{ color: "#7dffc8" }}>nine</span>
            <span style={{ color: "#ff7a6e" }}>sixteen</span>
            <span>.video</span>
          </div>
          <div
            style={{
              display: "flex",
              border: "2px solid #3a3835",
              borderRadius: 16,
              padding: "18px 28px",
              fontSize: 22,
              color: "#c8c2b8",
            }}
          >
            Free to try
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
