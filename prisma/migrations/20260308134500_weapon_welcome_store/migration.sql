-- CreateTable
CREATE TABLE "WeaponStat" (
    "weapon" TEXT NOT NULL PRIMARY KEY,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "longestDistance" REAL NOT NULL DEFAULT 0,
    "recordHolder" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WelcomeClaim" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "WeaponStat_kills_idx" ON "WeaponStat"("kills");

-- CreateIndex
CREATE INDEX "WeaponStat_updatedAt_idx" ON "WeaponStat"("updatedAt");
