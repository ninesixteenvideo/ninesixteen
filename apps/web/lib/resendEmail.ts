import { LEGAL_CONTACT_EMAIL } from "@/lib/legalMeta";

const RESEND_API = "https://api.resend.com/emails";

export function getResendFromAddress(): string {
  return (
    process.env.FEEDBACK_FROM_EMAIL?.trim() ||
    "ninesixteen.video <onboarding@resend.dev>"
  );
}

export function getResendToAddress(): string {
  return process.env.FEEDBACK_TO_EMAIL?.trim() || LEGAL_CONTACT_EMAIL;
}

type ResendEmailInput = {
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: { filename: string; content: string }[];
};

/** Send a plain-text email via Resend (free tier: 3k emails/month). */
export async function sendResendEmail(input: ResendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = getResendToAddress();
  const from = getResendFromAddress();

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[resend mock]", {
        to,
        from,
        subject: input.subject,
        text: input.text.slice(0, 300),
      });
      return;
    }
    throw new Error("Resend is not configured");
  }

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject: input.subject,
    text: input.text,
  };

  if (input.replyTo) {
    payload.reply_to = input.replyTo;
  }

  if (input.attachments?.length) {
    payload.attachments = input.attachments;
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
