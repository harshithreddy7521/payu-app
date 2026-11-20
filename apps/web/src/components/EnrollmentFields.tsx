"use client";
import {
  paymentPlans,
  type FeePlan,
  type PaymentPlan,
} from "../../../mobile/src/local/feePlans";
export type Enrollment = {
  paymentPlan: PaymentPlan;
  hostel: boolean;
  optionalCharges: string[];
};
export const defaultEnrollment: Enrollment = {
  paymentPlan: "MONTHLY",
  hostel: false,
  optionalCharges: [],
};

export default function EnrollmentFields({
  plan,
  value,
  onChange,
}: {
  plan: FeePlan;
  value: Enrollment;
  onChange: (value: Enrollment) => void;
}) {
  return (
    <>
      {plan.mode !== "SPORTS_RENEWAL" && (
        <label className="field">
          <span className="label">Payment plan</span>
          <select
            className="select"
            value={value.paymentPlan}
            onChange={(event) =>
              onChange({
                ...value,
                paymentPlan: event.target.value as PaymentPlan,
              })
            }
          >
            {Object.entries(paymentPlans).map(([option, label]) => (
              <option key={option} value={option}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {plan.mode === "SCHOOL" && plan.hostelPaise > 0 && (
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={value.hostel}
              onChange={(event) =>
                onChange({ ...value, hostel: event.target.checked })
              }
            />{" "}
            Hostel (₹{(plan.hostelPaise / 100).toLocaleString("en-IN")})
          </span>
        </label>
      )}
      {plan.charges
        .filter((charge) => charge.optional)
        .map((charge) => (
          <label className="field" key={charge.name}>
            <span>
              <input
                type="checkbox"
                checked={value.optionalCharges.includes(charge.name)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    optionalCharges: event.target.checked
                      ? [...value.optionalCharges, charge.name]
                      : value.optionalCharges.filter(
                          (name) => name !== charge.name,
                        ),
                  })
                }
              />{" "}
              {charge.name} (₹
              {(charge.amountPaise / 100).toLocaleString("en-IN")})
              {charge.upfront ? " · due upfront" : ""}
            </span>
          </label>
        ))}
    </>
  );
}
