-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bounty_id" INTEGER NOT NULL,
    "attempt_index" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_read_idx" ON "notifications"("recipient", "read");

-- CreateIndex
CREATE INDEX "notifications_recipient_created_at_idx" ON "notifications"("recipient", "created_at");
