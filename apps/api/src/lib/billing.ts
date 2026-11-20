const IST = 330 * 60_000;
export function localDate(now = new Date()): string {
  return new Date(now.getTime() + IST).toISOString().slice(0, 10);
}
export function istInstant(date: string, time = "00:00"): Date {
  return new Date(`${date}T${time}:00+05:30`);
}
export function cycleDate(
  year: number,
  month: number,
  day?: number | null,
): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day ? Math.min(day, last) : last).padStart(2, "0")}`;
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400_000)
    .toISOString()
    .slice(0, 10);
}
export function billingInterval(frequency: string) {
  return frequency === "YEARLY" ? 12 : frequency === "QUARTERLY" ? 3 : 1;
}
export function nextBillDates(
  group: {
    frequency: string;
    billDayOfMonth?: number | null;
    endsAt?: Date | null;
    createdAt?: Date | string;
  },
  count: number,
  from = new Date(),
): string[] {
  if (!["MONTHLY", "QUARTERLY", "YEARLY"].includes(group.frequency)) return [];
  const start = localDate(from);
  const [year, m] = start.split("-").map(Number);
  let month = m - 1;
  const step = billingInterval(group.frequency);
  const [anchorYear, anchorMonth] = group.createdAt
    ? localDate(new Date(group.createdAt)).split("-").map(Number)
    : [year, m];
  const elapsed = (year - anchorYear) * 12 + m - anchorMonth;
  month += (step - (((elapsed % step) + step) % step)) % step;
  const dates: string[] = [];
  for (let i = 0; i < count + 2 && dates.length < count; i++) {
    const date = cycleDate(
      year + Math.floor(month / 12),
      month % 12,
      group.billDayOfMonth,
    );
    if (group.endsAt && istInstant(date) > group.endsAt) break;
    if (istInstant(date) >= from) dates.push(date);
    month += step;
  }
  return dates;
}
