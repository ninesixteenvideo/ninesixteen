import { NextResponse } from "next/server";

/** True on Vercel production deployments and `next build` runtime. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Block mock/dev fallbacks in production — returns a 503 response or null. */
export function productionConfigRequired(service: string): NextResponse | null {
  if (!isProduction()) return null;
  return NextResponse.json(
    { error: `${service} is not configured for production` },
    { status: 503 }
  );
}
