const ALLOWED_ORIGINS = new Set([
  "https://ninesixteen.video",
  "http://localhost:3000",
  "http://localhost:1420",
  "https://tauri.localhost",
  "tauri://localhost",
]);

/** CORS headers for desktop WebView polling — never use `*`. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
