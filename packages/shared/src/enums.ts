export enum IndustryProfile {
  SCHOOL = "SCHOOL",
  SPORTS = "SPORTS",
  RESTAURANT = "RESTAURANT",
}

export enum UserRole {
  OWNER = "OWNER",
  FINANCE = "FINANCE",
  BRANCH_MANAGER = "BRANCH_MANAGER",
  COLLECTOR = "COLLECTOR",
  SUPPORT = "SUPPORT",
}

export enum OrgStatus {
  DRAFT = "DRAFT",
  UNDER_REVIEW = "UNDER_REVIEW",
  ACTION_REQUIRED = "ACTION_REQUIRED",
  ACTIVE = "ACTIVE",
  RESTRICTED = "RESTRICTED",
}

export enum BillStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  PARTIAL = "PARTIAL",
  PAID = "PAID",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export enum PaymentLinkStatus {
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
  PAID = "PAID",
}

export enum PaymentAttemptStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  UNKNOWN = "UNKNOWN",
}

export enum RefundStatus {
  REQUESTED = "REQUESTED",
  SUBMITTED = "SUBMITTED",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
}

export enum SettlementBatchStatus {
  SCHEDULED = "SCHEDULED",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export enum SettlementItemStatus {
  PENDING = "PENDING",
  SUBMITTED = "SUBMITTED",
  SETTLED = "SETTLED",
  FAILED = "FAILED",
  HELD = "HELD",
  RETURNED = "RETURNED",
  UNKNOWN = "UNKNOWN",
}

export enum LedgerEntryType {
  PAYMENT = "PAYMENT",
  REFUND = "REFUND",
  FEE = "FEE",
  SETTLEMENT = "SETTLEMENT",
  HOLD = "HOLD",
  HOLD_RELEASE = "HOLD_RELEASE",
  ADJUSTMENT = "ADJUSTMENT",
}

export enum MessageChannel {
  WHATSAPP = "WHATSAPP",
  SMS = "SMS",
  EMAIL = "EMAIL",
}

export enum DeliveryStatus {
  QUEUED = "QUEUED",
  SUBMITTED = "SUBMITTED",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
  SUPPRESSED = "SUPPRESSED",
  UNKNOWN = "UNKNOWN",
}

export enum BillingFrequency {
  ONE_TIME = "ONE_TIME",
  MONTHLY = "MONTHLY",
}

export enum DestinationType {
  BANK_ACCOUNT = "BANK_ACCOUNT",
  UPI_VPA = "UPI_VPA",
}
