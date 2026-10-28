ALTER TABLE "attempts"
ADD COLUMN "appeal_funding_deadline" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "appeal_base_funding_tx_hash" TEXT NOT NULL DEFAULT '';
