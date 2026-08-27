import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { startIndexer } from "./services/indexer.js";
import { bountyRoutes } from "./routes/bounties.js";
import { activityRoutes } from "./routes/activity.js";
import { reputationRoutes } from "./routes/reputation.js";
import { notificationRoutes } from "./routes/notifications.js";
import { evidenceRoutes } from "./routes/evidence.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
  },
});

await app.register(cors, {
  origin: [env.CORS_ORIGIN, "http://localhost:3000"],
});

// Generous but real rate limiting — this API only ever serves cached
// read-only data (never a payment-critical path), but must still resist
// casual scraping/abuse per PROOFBOUNTY.md section 31.
await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
});

await app.register(bountyRoutes);
await app.register(activityRoutes);
await app.register(reputationRoutes);
await app.register(notificationRoutes);
await app.register(evidenceRoutes);

// Liveness probe for Fly.io's health check — deliberately separate from
// /health's indexer status. A transient GenLayer RPC hiccup should never
// cause Fly to restart-loop the whole service; only "is the HTTP server
// itself responsive" gates that. /health (indexer + cache status) is for
// human/dashboard consumption, not container orchestration.
app.get("/livez", async () => ({ status: "ok" }));

app.get("/", async () => ({
  service: "proofbounty-api",
  status: "ok",
  docs: "/health for indexer status, /bounties for the marketplace cache",
}));

app.setErrorHandler((error: FastifyError, _request, reply) => {
  app.log.error(error);
  // Never leak internal error details to clients (PROOFBOUNTY.md section 43).
  reply.code(error.statusCode ?? 500).send({
    error: "internal_error",
    message: error.statusCode && error.statusCode < 500 ? error.message : "Something went wrong.",
  });
});

const indexerTimer = startIndexer(app.log);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  clearInterval(indexerTimer);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
