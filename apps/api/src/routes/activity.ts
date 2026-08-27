import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(30),
  address: z.string().optional(),
});

export async function activityRoutes(app: FastifyInstance) {
  app.get("/activity", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const { limit, address } = parsed.data;

    const where = address ? { actor: { equals: address, mode: "insensitive" as const } } : {};

    const events = await prisma.activityEvent.findMany({
      where,
      orderBy: { observedAt: "desc" },
      take: limit,
    });
    return { items: events };
  });

  app.get("/disputes", async (_request, reply) => {
    const disputed = await prisma.attempt.findMany({
      where: { statusLabel: "DISPUTED" },
      orderBy: { resolvedAt: "desc" },
      include: { bounty: true },
    });
    return { items: disputed };
  });

  app.get("/health", async (_request, reply) => {
    const state = await prisma.indexerState.findUnique({ where: { id: 1 } });
    const bountyCount = await prisma.bounty.count();
    const healthy = !state?.lastError && !!state?.lastPolledAt;
    reply.code(healthy ? 200 : 503);
    return {
      status: healthy ? "ok" : "degraded",
      indexer: state,
      cachedBounties: bountyCount,
    };
  });
}
