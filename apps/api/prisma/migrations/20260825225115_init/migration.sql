-- CreateTable
CREATE TABLE "bounties" (
    "bounty_id" INTEGER NOT NULL,
    "creator" TEXT NOT NULL,
    "arbiter" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "claim_text" TEXT NOT NULL,
    "claim_polarity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "proof_criteria" TEXT NOT NULL,
    "evidence_requirements" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "status_label" TEXT NOT NULL,
    "reward_amount" TEXT NOT NULL,
    "reward_deposited" TEXT NOT NULL,
    "required_bond" TEXT NOT NULL,
    "platform_fee_bps" INTEGER NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "attempts_won" INTEGER NOT NULL,
    "winning_attempt_index" INTEGER NOT NULL,
    "criteria_locked" BOOLEAN NOT NULL,
    "deadline" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bounties_pkey" PRIMARY KEY ("bounty_id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" TEXT NOT NULL,
    "bounty_id" INTEGER NOT NULL,
    "attempt_index" INTEGER NOT NULL,
    "challenger" TEXT NOT NULL,
    "bond_amount" TEXT NOT NULL,
    "bond_deposited" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "status_label" TEXT NOT NULL,
    "evidence_url" TEXT NOT NULL,
    "evidence_description" TEXT NOT NULL,
    "revision_count" INTEGER NOT NULL,
    "max_revisions" INTEGER NOT NULL,
    "last_verdict" TEXT NOT NULL,
    "last_reasoning" TEXT NOT NULL,
    "last_payout_bps" INTEGER NOT NULL,
    "disputed_by" TEXT NOT NULL,
    "dispute_reason" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    "submitted_at" INTEGER NOT NULL,
    "resolved_at" INTEGER NOT NULL,
    "resolved_by_arbiter" BOOLEAN NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation" (
    "address" TEXT NOT NULL,
    "bounties_created" INTEGER NOT NULL,
    "bounties_funded_total" TEXT NOT NULL,
    "attempts_made" INTEGER NOT NULL,
    "attempts_won" INTEGER NOT NULL,
    "attempts_partial" INTEGER NOT NULL,
    "attempts_rejected" INTEGER NOT NULL,
    "attempts_disputed" INTEGER NOT NULL,
    "total_earned" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "bounty_id" INTEGER NOT NULL,
    "attempt_index" INTEGER,
    "kind" TEXT NOT NULL,
    "actor" TEXT,
    "detail" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexer_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_bounty_count" INTEGER NOT NULL DEFAULT 0,
    "last_polled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,

    CONSTRAINT "indexer_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bounties_status_idx" ON "bounties"("status");

-- CreateIndex
CREATE INDEX "bounties_category_idx" ON "bounties"("category");

-- CreateIndex
CREATE INDEX "bounties_creator_idx" ON "bounties"("creator");

-- CreateIndex
CREATE INDEX "bounties_deadline_idx" ON "bounties"("deadline");

-- CreateIndex
CREATE INDEX "attempts_challenger_idx" ON "attempts"("challenger");

-- CreateIndex
CREATE INDEX "attempts_status_idx" ON "attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_bounty_id_attempt_index_key" ON "attempts"("bounty_id", "attempt_index");

-- CreateIndex
CREATE INDEX "activity_events_bounty_id_idx" ON "activity_events"("bounty_id");

-- CreateIndex
CREATE INDEX "activity_events_observed_at_idx" ON "activity_events"("observed_at");

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounties"("bounty_id") ON DELETE RESTRICT ON UPDATE CASCADE;
