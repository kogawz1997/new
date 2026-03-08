PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Purchase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_Purchase" (
    "id",
    "code",
    "userId",
    "itemId",
    "price",
    "status",
    "statusUpdatedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "code",
    "userId",
    "itemId",
    "price",
    "status",
    COALESCE("createdAt", CURRENT_TIMESTAMP),
    "createdAt",
    COALESCE("createdAt", CURRENT_TIMESTAMP)
FROM "Purchase";

DROP TABLE "Purchase";
ALTER TABLE "new_Purchase" RENAME TO "Purchase";
CREATE UNIQUE INDEX "Purchase_code_key" ON "Purchase"("code");

CREATE TABLE "WalletLedger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "actor" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletLedger_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "UserWallet" ("userId")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PurchaseStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseCode" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseStatusHistory_purchaseCode_fkey"
      FOREIGN KEY ("purchaseCode") REFERENCES "Purchase" ("code")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PlayerAccount" (
    "discordId" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "steamId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "WalletLedger_userId_createdAt_idx" ON "WalletLedger"("userId", "createdAt");
CREATE INDEX "WalletLedger_reason_createdAt_idx" ON "WalletLedger"("reason", "createdAt");
CREATE INDEX "PurchaseStatusHistory_purchaseCode_createdAt_idx" ON "PurchaseStatusHistory"("purchaseCode", "createdAt");
CREATE INDEX "PurchaseStatusHistory_toStatus_createdAt_idx" ON "PurchaseStatusHistory"("toStatus", "createdAt");
CREATE UNIQUE INDEX "PlayerAccount_steamId_key" ON "PlayerAccount"("steamId");

INSERT INTO "PurchaseStatusHistory" ("purchaseCode", "fromStatus", "toStatus", "reason", "createdAt")
SELECT "code", NULL, "status", 'migration-bootstrap', "createdAt"
FROM "Purchase";

PRAGMA foreign_keys=ON;
