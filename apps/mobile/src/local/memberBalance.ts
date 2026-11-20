export type BalanceBill = {
  id: string;
  purpose: string;
  amountPaise: number;
  paidPaise: number;
  plannedTotalPaise?: number;
  status: string;
};

export type MemberTotals = {
  paidPaise: number;
  duePaise: number;
  remainingPaise: number;
};

export function payable(bill: BalanceBill) {
  return (
    bill.status !== "CANCELLED" &&
    (bill.plannedTotalPaise !== undefined ||
      ["ISSUED", "PARTIAL", "EXPIRED"].includes(bill.status))
  );
}

export function remaining(bill: BalanceBill) {
  return Math.max(
    0,
    Math.max(bill.amountPaise, bill.plannedTotalPaise ?? 0) - bill.paidPaise,
  );
}

export function addBalance(totals: MemberTotals, bill: BalanceBill) {
  totals.paidPaise += bill.paidPaise;
  if (payable(bill)) {
    totals.duePaise += Math.max(0, bill.amountPaise - bill.paidPaise);
    totals.remainingPaise += remaining(bill);
  }
  return totals;
}

export function emptyBalance(): MemberTotals {
  return { paidPaise: 0, duePaise: 0, remainingPaise: 0 };
}
