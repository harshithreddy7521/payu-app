import { randomUUID } from "crypto";
import QRCode from "qrcode";

export interface ProviderOrder {
  providerOrderId: string;
  upiIntentUrl?: string;
  qrCodeDataUrl?: string;
}

export interface ProviderPaymentResult {
  status: "SUCCESS" | "FAILED" | "PENDING";
  providerRef?: string;
  amountPaise?: number;
}

export interface PaymentProvider {
  createOrder(params: { amountPaise: number; merchantOrderRef: string; description: string }): Promise<ProviderOrder>;
  verifyPayment(providerOrderId: string): Promise<ProviderPaymentResult>;
  refund(params: { providerRef: string; amountPaise: number; idempotencyKey: string; reason: string }): Promise<{ refundRef: string }>;
  settle(params: { amountPaise: number; destinationVpa?: string; ifsc?: string; accountNo?: string; idempotencyKey: string }): Promise<{ ref: string }>;
}

// Deterministic fake that auto-confirms after 2s (simulated via flag)
class FakePaymentProvider implements PaymentProvider {
  private pendingOrders = new Map<string, { amountPaise: number; createdAt: number }>();

  async createOrder({ amountPaise, merchantOrderRef, description }: { amountPaise: number; merchantOrderRef: string; description: string }): Promise<ProviderOrder> {
    const providerOrderId = `fake_order_${merchantOrderRef}_${Date.now()}`;
    this.pendingOrders.set(providerOrderId, { amountPaise, createdAt: Date.now() });
    const upiIntentUrl = `upi://pay?pa=fake@fakebank&pn=FeeApp&am=${(amountPaise / 100).toFixed(2)}&tn=${encodeURIComponent(description)}&tr=${providerOrderId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(upiIntentUrl);
    return { providerOrderId, upiIntentUrl, qrCodeDataUrl };
  }

  async verifyPayment(providerOrderId: string): Promise<ProviderPaymentResult> {
    const order = this.pendingOrders.get(providerOrderId);
    if (!order) return { status: "FAILED" };
    // Auto-succeed after 3 seconds for demo
    if (Date.now() - order.createdAt > 3000) {
      this.pendingOrders.delete(providerOrderId);
      return { status: "SUCCESS", providerRef: `fake_pay_${randomUUID()}`, amountPaise: order.amountPaise };
    }
    return { status: "PENDING" };
  }

  async refund({ idempotencyKey }: { providerRef: string; amountPaise: number; idempotencyKey: string; reason: string }): Promise<{ refundRef: string }> {
    return { refundRef: `fake_refund_${idempotencyKey}` };
  }

  async settle({ idempotencyKey }: { amountPaise: number; destinationVpa?: string; ifsc?: string; accountNo?: string; idempotencyKey: string }): Promise<{ ref: string }> {
    return { ref: `fake_settle_${idempotencyKey}` };
  }
}

export function getPaymentProvider(): PaymentProvider {
  // ponytail: single adapter, add real Razorpay/Cashfree adapter when provider chosen
  return new FakePaymentProvider();
}
