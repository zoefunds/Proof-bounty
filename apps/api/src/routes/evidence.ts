import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function evidenceRoutes(app: FastifyInstance) {
  app.get("/bounties/:id/attempts/:index/evidence-archive", async (request, reply) => {
    const { id, index } = request.params as { id: string; index: string };
    const bountyId = Number(id);
    const attemptIndex = Number(index);
    if (!Number.isInteger(bountyId) || !Number.isInteger(attemptIndex)) {
      return reply.code(400).send({ error: "invalid_params" });
    }

    const archives = await prisma.evidenceArchive.findMany({
      where: { bountyId, attemptIndex },
      orderBy: { fetchedAt: "desc" },
      select: {
        id: true,
        url: true,
        contentSha256: true,
        contentType: true,
        byteLength: true,
        truncated: true,
        fetchedAt: true,
        fetchError: true,
        localContentDigest: true,
        onChainHashMatch: true,
        onChainHashCheckedAt: true,
        // `content` deliberately excluded from the list response — could
        // be up to 500KB; fetch it explicitly via the :archiveId route
        // below when actually needed.
      },
    });
    return { items: archives };
  });

  app.get("/evidence-archive/:archiveId", async (request, reply) => {
    const { archiveId } = request.params as { archiveId: string };
    const archive = await prisma.evidenceArchive.findUnique({ where: { id: archiveId } });
    if (!archive) return reply.code(404).send({ error: "not_found" });
    return archive;
  });
}
