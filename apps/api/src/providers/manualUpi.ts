import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import type { PaymentProvider, ProviderOrder, ProviderPaymentResult } from "./payment.js";

export function manualUpiPayee() {
  return process.env.UPI_PAYEE_VPA?.trim() || "7090832433@ybl";
}

// Direct UPI handoff only. There is no bank/provider confirmation feed yet.
export class ManualUpiProvider implements PaymentProvider {
  private async order(providerOrderId: string, amountPaise: number, description: string): Promise<ProviderOrder> {
    const params = new URLSearchParams({ pa: manualUpiPayee(), pn: process.env.UPI_PAYEE_NAME?.trim() || "UPI recipient", am: (amountPaise / 100).toFixed(2), cu: "INR", tn: description.slice(0, 80), tr: providerOrderId });
    const upiIntentUrl = `upi://pay?${params}`;
    return { providerOrderId, upiIntentUrl, qrCodeDataUrl: await QRCode.toDataURL(upiIntentUrl) };
  }
  async createOrder({ amountPaise, description }: { amountPaise: number; merchantOrderRef: string; description: string }) {
    return this.order(`UPI${randomUUID().replaceAll("-", "")}`, amountPaise, description);
  }
  async getOrder(providerOrderId: string) {
    const attempt = await prisma.paymentAttempt.findUnique({ where: { providerOrderId }, include: { link: { include: { bill: true } } } });
    if (!attempt) return null;
    return this.order(providerOrderId, attempt.amountPaise, attempt.link.bill.purpose);
  }
  async verifyPayment(_providerOrderId: string): Promise<ProviderPaymentResult> {
    return { status: "PENDING" };
  }
  async refund(): Promise<{ refundRef: string }> { throw new Error("Direct UPI refunds need a verified payment provider"); }
  async settle(): Promise<{ ref: string }> { throw new Error("Direct UPI does not support platform settlements"); }
}
