export function rupeesToPaise(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a positive amount with up to two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 50000000)
    throw new Error("Amount must be between ₹0.01 and ₹5,00,000.");
  return amount;
}
export function releaseApiOrigin(value: string, development: boolean) {
  const parsed = new URL(value);
  if (
    !["https:", ...(development ? ["http:"] : [])].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      "Configure a valid HTTPS API URL without embedded credentials.",
    );
  return parsed.origin;
}
