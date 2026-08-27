import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const listQuerySchema = z.object({
  address: z.string().min(1),
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const { address, unreadOnly, limit } = parsed.data;

    const where = {
      recipient: address.toLowerCase(),
      ...(unreadOnly ? { read: false } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.notification.count({ where: { recipient: address.toLowerCase(), read: false } }),
    ]);

    return { items, unreadCount };
  });

  app.post("/notifications/:id/read", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
      return updated;
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const parsed = z.object({ address: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const result = await prisma.notification.updateMany({
      where: { recipient: parsed.data.address.toLowerCase(), read: false },
      data: { read: true },
    });
    return { updated: result.count };
  });
}
