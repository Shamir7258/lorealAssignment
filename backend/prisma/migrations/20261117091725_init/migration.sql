-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('PENDING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED');

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "market" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'PENDING',
    "justified" BOOLEAN,
    "confidenceScore" DOUBLE PRECISION,
    "reasoning" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assessment_claimId_idx" ON "Assessment"("claimId");

-- CreateIndex
CREATE INDEX "Assessment_status_idx" ON "Assessment"("status");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
