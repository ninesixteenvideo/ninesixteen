import { jsonWithCors, optionsResponse, withCors } from "@/lib/cors";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { registerDesktopAuthHandoff } from "@/lib/desktopAuthSession";
import { registerDriveAuthHandoff } from "@/lib/driveAuthSession";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/** Desktop app registers a one-time handoff code + secret before opening the browser. */
export async function POST(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin", isAdminConfigured);
  if (blocked) return withCors(req, blocked);

  if (!isAdminConfigured) {
    return jsonWithCors(req, { ok: true, mock: true });
  }

  const ip = clientIp(req);
  if (!rateLimit(`handoff-register:${ip}`, 30, 60_000)) {
    return jsonWithCors(req, { error: "Too many requests" }, { status: 429 });
  }

  let body: { code?: string; secret?: string; kind?: string; verifier?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonWithCors(req, { error: "Invalid body" }, { status: 400 });
  }

  const code = body.code?.trim() ?? "";
  const secret = body.secret?.trim() ?? "";
  const kind = body.kind?.trim();
  const verifier = body.verifier?.trim() ?? "";

  if (!UUID_RE.test(code) || secret.length < 16 || secret.length > 256) {
    return jsonWithCors(req, { error: "Invalid handoff parameters" }, { status: 400 });
  }

  let ok = false;
  if (kind === "desktop") {
    // Desktop handoffs require a short user-visible verification code.
    if (!/^[A-Z0-9]{4,12}$/.test(verifier.toUpperCase())) {
      return jsonWithCors(
        req,
        { error: "Invalid handoff parameters" },
        { status: 400 }
      );
    }
    ok = await registerDesktopAuthHandoff(code, secret, verifier);
  } else if (kind === "drive") {
    ok = await registerDriveAuthHandoff(code, secret);
  }

  if (!ok) {
    return jsonWithCors(req, { error: "Could not register handoff" }, { status: 500 });
  }

  return jsonWithCors(req, { ok: true });
}
