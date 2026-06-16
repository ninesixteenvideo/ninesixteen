import { LEGAL_CONTACT_EMAIL } from "@/lib/legalMeta";

const RESEND_API = "https://api.resend.com/emails";

export type FeedbackEmailInput = {
  message: string;
  email?: string;
  sendLogs: boolean;
  logs?: string;
  appVersion?: string;
  platform?: string;
  source?: string;
};

/** Send feedback to dev@ via Resend (free tier: 3k emails/month). */
export async function sendFeedbackEmail(input: FeedbackEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.FEEDBACK_TO_EMAIL?.trim() || LEGAL_CONTACT_EMAIL;
  const from =
    process.env.FEEDBACK_FROM_EMAIL?.trim() ||
    "ninesixteen.video <onboarding@resend.dev>";

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[feedback mock]", {
        to,
        from,
        subject: buildSubject(input),
        message: input.message.slice(0, 200),
        sendLogs: input.sendLogs,
        logBytes: input.logs?.length ?? 0,
      });
      return;
    }
    throw new Error("Feedback email is not configured");
  }

  const body = buildEmailBody(input);
  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject: buildSubject(input),
    text: body,
  };

  if (input.email) {
    payload.reply_to = input.email;
  }

  if (input.sendLogs && input.logs) {
    payload.attachments = [
      {
        filename: "ninesixteen.log",
        content: Buffer.from(input.logs, "utf8").toString("base64"),
      },
    ];
  }

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Resend error (${res.status})`);
  }
}

function buildSubject(input: FeedbackEmailInput): string {
  const source = input.source?.trim() || "desktop";
  return `[ninesixteen] ${source} feedback`;
}

function buildEmailBody(input: FeedbackEmailInput): string {
  const lines = [
    "New feedback from ninesixteen.video",
    "",
    `Source: ${input.source || "desktop"}`,
    `App version: ${input.appVersion || "unknown"}`,
    `Platform: ${input.platform || "unknown"}`,
    `Reply-to: ${input.email || "(not provided)"}`,
    `Logs attached: ${input.sendLogs ? "yes" : "no"}`,
    "",
    "--- Message ---",
    input.message,
  ];
  return lines.join("\n");
}
