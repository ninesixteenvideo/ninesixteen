import { jsonWithCors, optionsResponse, withCors } from "@/lib/cors";
import { sendFeedbackEmail } from "@/lib/feedbackEmail";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 5000;
const MAX_LOG_BYTES = 512 * 1024;

export async function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/** Desktop (and future web) bug reports → dev@ninesixteen.video via Resend. */
export async function POST(req: Request) {
  const configured = Boolean(process.env.RESEND_API_KEY?.trim());
  const blocked = productionConfigRequired("Feedback email (Resend)", configured);
  if (blocked) return withCors(req, blocked);

  const ip = clientIp(req);
  if (!rateLimit(`feedback:${ip}`, 8, 60 * 60_000)) {
    return jsonWithCors(req, { error: "Too many requests — try again later." }, { status: 429 });
  }

  let body: {
    message?: string;
    email?: string;
    sendLogs?: boolean;
    logs?: string;
    appVersion?: string;
    platform?: string;
    source?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonWithCors(req, { error: "Invalid body" }, { status: 400 });
  }

  const message = body.message?.trim() ?? "";
  if (message.length < 10) {
    return jsonWithCors(req, { error: "Message must be at least 10 characters." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return jsonWithCors(req, { error: "Message is too long." }, { status: 400 });
  }

  const email = body.email?.trim();
  if (email && !EMAIL_RE.test(email)) {
    return jsonWithCors(req, { error: "Invalid email address." }, { status: 400 });
  }

  const sendLogs = Boolean(body.sendLogs);
  let logs = sendLogs ? body.logs?.trim() : undefined;
  if (logs && logs.length > MAX_LOG_BYTES) {
    logs = logs.slice(-MAX_LOG_BYTES);
  }

  try {
    await sendFeedbackEmail({
      message,
      email: email || undefined,
      sendLogs,
      logs,
      appVersion: body.appVersion?.trim() || undefined,
      platform: body.platform?.trim() || undefined,
      source: body.source?.trim() || "desktop",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not send feedback";
    return jsonWithCors(req, { error: msg }, { status: 500 });
  }

  return jsonWithCors(req, { ok: true, mock: !configured });
}
