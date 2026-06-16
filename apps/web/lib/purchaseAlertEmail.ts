import { sendResendEmail } from "@/lib/resendEmail";

export type PurchaseAlertInput = {
  uid: string;
  email?: string | null;
  amountCents: number;
  currency: string;
  stripeSessionId: string;
};

/** Notify the developer when a Pro purchase completes. */
export async function sendPurchaseAlertEmail(
  input: PurchaseAlertInput
): Promise<void> {
  const amount = (input.amountCents / 100).toFixed(2);
  const currency = input.currency.toUpperCase();
  const buyer = input.email?.trim() || "(email not provided)";

  await sendResendEmail({
    subject: `[ninesixteen] Pro purchase · ${currency} ${amount}`,
    text: [
      "New Pro purchase on ninesixteen.video",
      "",
      `Amount: ${currency} ${amount}`,
      `Buyer: ${buyer}`,
      `Firebase uid: ${input.uid}`,
      `Stripe session: ${input.stripeSessionId}`,
      "",
      "Pro entitlement was written to Firestore.",
    ].join("\n"),
    replyTo: input.email?.trim() || undefined,
  });
}
