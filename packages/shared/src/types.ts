import {
  BillStatus, BillingFrequency, DeliveryStatus, DestinationType,
  IndustryProfile, LedgerEntryType, MessageChannel, OrgStatus,
  PaymentAttemptStatus, PaymentLinkStatus, RefundStatus,
  SettlementBatchStatus, SettlementItemStatus, UserRole,
} from "./enums";

export interface ApiResponse<T> {
  data: T;
  meta?: { cursor?: string; total?: number };
}

export interface ApiError {
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

// Auth
export interface TokenPayload {
  sub: string; // userId
  orgId: string;
  roles: UserRole[];
  branchIds: string[];
  iat: number;
  exp: number;
}

export interface LoginRequest { email: string; password: string; }
export interface LoginResponse { token: string; user: UserSummary; }

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  orgId: string;
  orgName: string;
  profile: IndustryProfile;
  branchIds: string[];
}

// Quick Pay
export interface QuickPayRequest {
  amountPaise: number;
  branchId: string;
  purpose: string;
  memberId?: string;
  recipientName?: string;
  recipientPhone?: string;
  isGuest?: boolean;
  deliveryChannel?: MessageChannel;
  idempotencyKey?: string;
}

export interface QuickPayResponse {
  billId: string;
  paymentLinkToken: string;
  checkoutUrl: string;
  status: BillStatus;
  deliveryStatus?: DeliveryStatus;
}

// Checkout (payer-facing)
export interface CheckoutContext {
  token: string;
  merchantName: string;
  purpose: string;
  amountPaise: number;
  currency: "INR";
  expiresAt: string;
  status: PaymentLinkStatus;
  remainingPaise: number;
}

export interface CheckoutRequest {
  amountPaise: number; // validated server-side, never trusted
  upiApp?: string;
}

export interface CheckoutResponse {
  attemptId: string;
  providerOrderId: string;
  upiIntentUrl?: string;
  qrCodeDataUrl?: string;
  status: PaymentAttemptStatus;
}

// Dashboard
export interface DashboardStats {
  grossConfirmedPaise: number;
  outstandingPaise: number;
  refundedPaise: number;
  availablePaise: number;
  heldPaise: number;
  settledPaise: number;
  dateFrom: string;
  dateTo: string;
  dateBasis: "BILL_CREATED" | "PAYMENT_CONFIRMED" | "SETTLEMENT";
}

// Bill
export interface BillSummary {
  id: string;
  orgId: string;
  branchId: string;
  memberId?: string;
  memberName?: string;
  purpose: string;
  amountPaise: number;
  paidPaise: number;
  status: BillStatus;
  createdAt: string;
  dueAt?: string;
}

// Settlement
export interface SettlementBatchSummary {
  id: string;
  orgId: string;
  reportingDate: string;
  status: SettlementBatchStatus;
  totalPaise: number;
  feePaise: number;
  refundPaise: number;
  netPaise: number;
  runAt?: string;
}
