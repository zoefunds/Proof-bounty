-- AlterTable
ALTER TABLE "attempts" ADD COLUMN     "appeal_bond_deposited" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "appeal_deadline" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "appeal_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "appealed_by" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "evidence_content_hash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "evidence_fetched_at" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pending_arbiter_verdict" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pending_payout_bps" INTEGER NOT NULL DEFAULT 0;
