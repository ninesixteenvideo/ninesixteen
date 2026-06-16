import { sendResendEmail } from "@/lib/resendEmail";

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
  const attachments =
    input.sendLogs && input.logs
      ? [
          {
            filename: "ninesixteen.log",
            content: Buffer.from(input.logs, "utf8").toString("base64"),
          },
        ]
      : undefined;

  await sendResendEmail({
    subject: buildSubject(input),
    text: buildEmailBody(input),
    replyTo: input.email,
    attachments,
  });
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
