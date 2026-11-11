// Compute next N bill issue dates for a group (IST)
export function nextBillDates(group: { frequency: string; billDayOfMonth?: number | null; endsAt?: Date | null }, count: number): string[] {
  if (group.frequency !== "MONTHLY") return [];
  const now = new Date();
  const dates: string[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-based

  while (dates.length < count) {
    month++;
    if (month > 11) { month = 0; year++; }
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const day = group.billDayOfMonth ? Math.min(group.billDayOfMonth, daysInMonth) : daysInMonth;
    const d = new Date(Date.UTC(year, month, day));
    if (group.endsAt && d > group.endsAt) break;
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
