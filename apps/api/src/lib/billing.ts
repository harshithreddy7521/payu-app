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
export function nextBillDates(
  group: {
    frequency: string;
    billDayOfMonth?: number | null;
    endsAt?: Date | null;
  },
  count: number,
  from = new Date(),
): string[] {
  if (group.frequency !== "MONTHLY") return [];
  const start = localDate(from);
  let [year, m] = start.split("-").map(Number);
  let month = m - 1;
  const dates: string[] = [];
  for (let i = 0; i < count + 2 && dates.length < count; i++) {
    const date = cycleDate(year, month, group.billDayOfMonth);
    if (group.endsAt && istInstant(date) > group.endsAt) break;
    if (istInstant(date) >= from) dates.push(date);
    month++;
    if (month === 12) {
      month = 0;
      year++;
    }
  }
  return dates;
}
