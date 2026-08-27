/*
  Warnings:

  - Added the required column `local_content_digest` to the `evidence_archives` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "evidence_archives" ADD COLUMN     "local_content_digest" TEXT NOT NULL,
ADD COLUMN     "on_chain_hash_checked_at" TIMESTAMP(3),
ADD COLUMN     "on_chain_hash_match" BOOLEAN;
