import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Err } from "@fee/shared";
export async function once<T>(
  tx: Prisma.TransactionClient,
  orgId: string,
  operation: string,
  key: string,
  body: unknown,
  action: () => Promise<T>,
): Promise<T> {
  if (!key || key.length > 200)
    throw Err.validation("Idempotency-Key must contain 1–200 characters");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId + ":" + operation + ":" + key}))`;
  const old = await tx.requestResult.findUnique({
    where: { orgId_operation_key: { orgId, operation, key } },
  });
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw Err.conflict(
        "Idempotency key was already used with different request details",
      );
    return old.result as T;
  }
  const result = await action();
  await tx.requestResult.create({
    data: {
      orgId,
      operation,
      key,
      fingerprint,
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  return result;
}
