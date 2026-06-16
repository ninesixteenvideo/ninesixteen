import { invoke, isDesktop } from "./bridge";

export async function submitFeedback(
  message: string,
  email: string | undefined,
  sendLogs: boolean
): Promise<void> {
  if (!isDesktop) {
    throw new Error("Feedback is only available in the desktop app.");
  }
  await invoke("submit_feedback", {
    message,
    email: email?.trim() || null,
    sendLogs,
  });
}
