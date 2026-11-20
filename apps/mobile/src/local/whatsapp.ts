export const indianMobile = /^(?:\+91)?[6-9]\d{9}$/;

export function sharePaymentLink(intent: string, webOrigin?: string) {
  return webOrigin?.startsWith("https://")
    ? webOrigin.replace(/\/$/, "") + "/pay/direct#" + encodeURIComponent(intent)
    : intent;
}

export function whatsappPayment(
  phone: string,
  intent: string,
  purpose: string,
  amountPaise: number,
  webOrigin?: string,
  language = "en",
  breakdown?: { previous: number; newlyDue: number; paid: number },
) {
  if (!indianMobile.test(phone))
    throw new Error("Enter a valid Indian mobile number.");
  const link = sharePaymentLink(intent, webOrigin);
  const amount = (amountPaise / 100).toFixed(2);
  const text =
    language === "hi"
      ? `${purpose} के लिए ₹${amount} का भुगतान करें। ${link}`
      : breakdown
        ? `${purpose}\nPrevious balance ₹${(breakdown.previous / 100).toFixed(2)}\nNew charges still due ₹${(breakdown.newlyDue / 100).toFixed(2)}\nPayments received to date ₹${(breakdown.paid / 100).toFixed(2)}\nTotal due ₹${amount}\n${link}`
        : `Please pay ₹${amount} for ${purpose}. ${link}`;
  return (
    "https://wa.me/91" + phone.slice(-10) + "?text=" + encodeURIComponent(text)
  );
}
