export type SchoolProfile = {
  name: string;
  address: string;
  phone: string;
  vpa: string;
  industry?: WorkspaceType;
  standardFeePaise?: number;
  storage: "local" | "cloud";
};

export const validVpa = (value: string) =>
  /^[a-z0-9._-]{1,100}@[a-z0-9.-]{2,64}$/i.test(value.trim());

export function validateSchool(profile: SchoolProfile) {
  if (
    (profile.industry !== undefined &&
      !Object.hasOwn(workspaceTypes, profile.industry)) ||
    !profile.name.trim() ||
    profile.name.length > 100 ||
    !profile.address.trim() ||
    !/^\+?[0-9]{8,15}$/.test(profile.phone.trim().replace(/[ -]/g, ""))
  )
    throw new Error(
      "Enter the workspace name, address and a valid contact number.",
    );
  if (!validVpa(profile.vpa))
    throw new Error("Enter your workspace’s UPI address.");
}

export function upiUrl(
  vpa: string,
  name: string,
  payment?: {
    amountPaise: number;
    purpose: string;
    id: string;
  },
) {
  if (!validVpa(vpa))
    throw new Error("Configure your workspace’s UPI address in Settings.");
  const params = new URLSearchParams({ pa: vpa.trim(), pn: name, cu: "INR" });
  if (payment) {
    params.set("am", (payment.amountPaise / 100).toFixed(2));
    params.set("tn", payment.purpose.slice(0, 80));
    params.set("tr", payment.id.replace(/-/g, ""));
  }
  return "upi://pay?" + params.toString();
}

export const workspaceTypes = {
  SCHOOL: "School",
  SPORTS: "Sports complex",
  RESTAURANT: "Restaurant",
} as const;
export type WorkspaceType = keyof typeof workspaceTypes;
export const billingFrequencies = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
} as const;
export type FeeFrequency = keyof typeof billingFrequencies;
