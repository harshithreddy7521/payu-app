import { MessageChannel } from "@fee/shared";

export interface SendResult {
  messageId: string;
  status: "SUBMITTED" | "FAILED";
  error?: string;
}

export interface MessagingProvider {
  send(params: {
    channel: MessageChannel;
    to: string;
    templateKey: string;
    variables: Record<string, string>;
    language?: string;
  }): Promise<SendResult>;
}

class FakeMessagingProvider implements MessagingProvider {
  async send({ channel, to, templateKey, variables }: {
    channel: MessageChannel; to: string; templateKey: string;
    variables: Record<string, string>; language?: string;
  }): Promise<SendResult> {
    const messageId = `fake_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[FAKE-MSG] ${channel} → ${to} | template=${templateKey}`, variables);
    return { messageId, status: "SUBMITTED" };
  }
}

export function getMessagingProvider(): MessagingProvider {
  // ponytail: add WhatsApp Business API + DLT-registered SMS adapter before launch
  return new FakeMessagingProvider();
}

// Template registry — start with payment_request; add reminders, receipts
export const TEMPLATES: Record<string, { whatsapp?: string; sms?: string; en: string; hi: string }> = {
  payment_request: {
    en: "Pay ₹{amount} to {merchant} for {purpose}. Link: {link}",
    hi: "{merchant} को {purpose} के लिए ₹{amount} भुगतान करें। लिंक: {link}",
  },
  payment_receipt: {
    en: "Payment of ₹{amount} received. Receipt #{receipt}. Thank you.",
    hi: "₹{amount} का भुगतान प्राप्त हुआ। रसीद #{receipt}। धन्यवाद।",
  },
  reminder_before: {
    en: "Reminder: ₹{amount} due {dueDate} for {purpose}. Pay: {link}",
    hi: "अनुस्मारक: {purpose} के लिए ₹{amount} {dueDate} को देय है। भुगतान: {link}",
  },
};
