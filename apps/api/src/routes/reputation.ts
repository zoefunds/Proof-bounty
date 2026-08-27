import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function reputationRoutes(app: FastifyInstance) {
  app.get("/reputation/:address", async (request, reply) => {
    const address = (request.params as { address: string }).address.toLowerCase();
    const rep = await prisma.reputation.findUnique({ where: { address } });
    if (!rep) {
      // Never seen by the indexer yet is not an error — it just means this
      // address has no cached activity; the frontend already falls back to
      // a direct contract read (get_reputation) for the authoritative
      // zeroed shape in this case.
      reply.code(404);
      return { error: "not_indexed_yet", address };
    }
    return rep;
  });
}
