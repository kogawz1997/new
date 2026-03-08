-- CreateTable
CREATE TABLE "CartEntry" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "itemId")
);

-- CreateIndex
CREATE INDEX "CartEntry_userId_updatedAt_idx" ON "CartEntry"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CartEntry_updatedAt_idx" ON "CartEntry"("updatedAt");
