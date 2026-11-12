import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "@fee/shared";
import { randomUUID } from "crypto";

export function errorHandler(
  error: FastifyError,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const correlationId = randomUUID();
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    return reply.status(409).send({
      code: "CONFLICT",
      message: "This reference already exists. Refresh and try again.",
      correlationId,
    });
  if (error instanceof ZodError)
    return reply.status(400).send({
      code: "VALIDATION_ERROR",
      message: "Check the submitted fields",
      details: error.flatten(),
      correlationId,
    });
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      correlationId,
      details: error.details,
    });
  }
  if (error.statusCode === 401) {
    return reply.status(401).send({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      correlationId,
    });
  }
  if (
    error.code?.startsWith("FST_ERR_") &&
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message:
        error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
          ? "A JSON body is required when Content-Type is application/json"
          : "Invalid request",
      correlationId,
    });
  }
  req.log.error({ err: error, correlationId }, "Unhandled error");
  return reply.status(500).send({
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
    correlationId,
  });
}
