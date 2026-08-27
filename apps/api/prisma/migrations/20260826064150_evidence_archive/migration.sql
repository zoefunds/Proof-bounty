-- CreateTable
CREATE TABLE "evidence_archives" (
    "id" TEXT NOT NULL,
    "bounty_id" INTEGER NOT NULL,
    "attempt_index" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetch_error" TEXT,

    CONSTRAINT "evidence_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_archives_bounty_id_attempt_index_idx" ON "evidence_archives"("bounty_id", "attempt_index");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_archives_bounty_id_attempt_index_content_sha256_key" ON "evidence_archives"("bounty_id", "attempt_index", "content_sha256");
