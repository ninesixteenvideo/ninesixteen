import { NextResponse } from "next/server";

/** Origins used by the Tauri desktop WebView (dev + release). */
const ALLOWED_ORIGINS = new Set([
  "https://ninesixteen.video",
  "http://localhost:3000",
  "http://localhost:1420",
  "https://tauri.localhost",
  "http://tauri.localhost",
  "tauri://localhost",
]);

/** CORS headers for desktop WebView fetch — never use `*`. */
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

/** Attach desktop CORS headers to an existing response. */
export function withCors(req: Request, response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders(req))) {
    response.headers.set(key, value);
  }
  return response;
}

export function jsonWithCors(
  req: Request,
  data: unknown,
  init?: ResponseInit
): NextResponse {
  return withCors(req, NextResponse.json(data, init));
}

export function optionsResponse(req: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
