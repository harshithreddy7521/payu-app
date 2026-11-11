import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { automationRoutes } from "./routes/automation.js";
import { authRoutes } from "./routes/auth.js";
import { quickPayRoutes } from "./routes/quickPay.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { memberRoutes } from "./routes/members.js";
import { groupRoutes } from "./routes/groups.js";
import { transactionRoutes } from "./routes/transactions.js";
import { settlementRoutes } from "./routes/settlements.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { refundRoutes } from "./routes/refunds.js";
import { errorHandler } from "./middleware/error.js";

const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" } });

await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET ?? "dev-secret-change-me" });

await app.register(swagger, {
  openapi: {
    info: { title: "India Fee Collection API", version: "1.0.0" },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
  },
});
await app.register(swaggerUi, { routePrefix: "/docs" });

app.setErrorHandler(errorHandler);

await app.register(automationRoutes, { prefix: "/v1" });
await app.register(authRoutes, { prefix: "/v1/auth" });
await app.register(quickPayRoutes, { prefix: "/v1" });
await app.register(dashboardRoutes, { prefix: "/v1" });
await app.register(checkoutRoutes, { prefix: "/pay" });
await app.register(memberRoutes, { prefix: "/v1/members" });
await app.register(groupRoutes, { prefix: "/v1/groups" });
await app.register(transactionRoutes, { prefix: "/v1/transactions" });
await app.register(settlementRoutes, { prefix: "/v1/settlements" });
await app.register(webhookRoutes, { prefix: "/v1/webhooks" });
await app.register(refundRoutes, { prefix: "/v1/refunds" });

app.get("/health", () => ({ ok: true, ts: new Date().toISOString() }));

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API running on http://localhost:${port}`);
console.log(`Docs at http://localhost:${port}/docs`);
