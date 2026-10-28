import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { confirmAttemptFunding, createAttemptFundingAuthorization } from "../services/base-relayer.js";

const identity = z.object({
  bountyId: z.number().int().nonnegative(),
  reservationId: z.number().int().nonnegative(),
  challenger: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export async function baseFundingRoutes(app: FastifyInstance) {
  app.post("/base/funding-authorization", async (request, reply) => {
    const parsed = identity.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try { return await createAttemptFundingAuthorization(parsed.data.bountyId, parsed.data.reservationId, parsed.data.challenger); }
    catch (error) { return reply.code(409).send({ error: "funding_authorization_refused", message: error instanceof Error ? error.message : "authorization refused" }); }
  });

  app.post("/base/funding-confirmation", async (request, reply) => {
    const parsed = identity.extend({ baseFundingTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try { return await confirmAttemptFunding(parsed.data.bountyId, parsed.data.reservationId, parsed.data.challenger, parsed.data.baseFundingTxHash); }
    catch (error) { return reply.code(409).send({ error: "funding_confirmation_failed", message: error instanceof Error ? error.message : "confirmation failed" }); }
  });
}
