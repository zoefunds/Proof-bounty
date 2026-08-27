import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const listQuerySchema = z.object({
  category: z.string().optional(),
  status: z.string().optional(),
  creator: z.string().optional(),
  sort: z.enum(["reward-desc", "ending-soon", "newest"]).default("newest"),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  q: z.string().optional(),
});

export async function bountyRoutes(app: FastifyInstance) {
  app.get("/bounties", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const { category, status, creator, sort, limit, offset, q } = parsed.data;

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.statusLabel = status;
    if (creator) where.creator = { equals: creator, mode: "insensitive" };
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { claimText: { contains: q, mode: "insensitive" } },
      ];
    }

    const orderBy =
      sort === "reward-desc"
        ? [{ rewardAmount: "desc" as const }]
        : sort === "ending-soon"
        ? [{ deadline: "asc" as const }]
        : [{ bountyId: "desc" as const }];

    const [items, total] = await Promise.all([
      prisma.bounty.findMany({ where, orderBy, take: limit, skip: offset }),
      prisma.bounty.count({ where }),
    ]);

    return { items, total, limit, offset };
  });

  app.get("/bounties/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid_id" });

    const bounty = await prisma.bounty.findUnique({
      where: { bountyId: id },
      include: { attempts: { orderBy: { attemptIndex: "asc" } } },
    });
    if (!bounty) return reply.code(404).send({ error: "not_found" });
    return bounty;
  });

  app.get("/bounties/:id/attempts", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid_id" });

    const attempts = await prisma.attempt.findMany({
      where: { bountyId: id },
      orderBy: { attemptIndex: "asc" },
    });
    return { items: attempts };
  });

  app.get("/attempts", async (request, reply) => {
    const parsed = z
      .object({ challenger: z.string().min(1) })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const attempts = await prisma.attempt.findMany({
      where: { challenger: { equals: parsed.data.challenger, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      include: { bounty: true },
    });
    return { items: attempts };
  });

  app.get("/bounties/:id/activity", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid_id" });

    const events = await prisma.activityEvent.findMany({
      where: { bountyId: id },
      orderBy: { observedAt: "desc" },
      take: 100,
    });
    return { items: events };
  });
}
