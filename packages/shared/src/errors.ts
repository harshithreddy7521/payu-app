export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Err = {
  unauthorized: () => new AppError("UNAUTHORIZED", "Authentication required", 401),
  forbidden: (msg = "Insufficient permissions") => new AppError("FORBIDDEN", msg, 403),
  notFound: (entity: string) => new AppError("NOT_FOUND", `${entity} not found`, 404),
  conflict: (msg: string) => new AppError("CONFLICT", msg, 409),
  validation: (msg: string, details?: Record<string, unknown>) =>
    new AppError("VALIDATION_ERROR", msg, 400, details),
  idempotencyConflict: () =>
    new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different body", 409),
  providerError: (msg: string) => new AppError("PROVIDER_ERROR", msg, 502),
};
