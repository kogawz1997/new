CREATE TABLE "BotConfig" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "configJson" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DeliveryQueueJob" (
  "purchaseCode" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemName" TEXT,
  "iconUrl" TEXT,
  "gameItemId" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "deliveryItemsJson" TEXT,
  "itemKind" TEXT,
  "guildId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME NOT NULL,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DeliveryQueueJob_nextAttemptAt_idx" ON "DeliveryQueueJob"("nextAttemptAt");
CREATE INDEX "DeliveryQueueJob_updatedAt_idx" ON "DeliveryQueueJob"("updatedAt");

CREATE TABLE "DeliveryDeadLetter" (
  "purchaseCode" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "itemId" TEXT,
  "itemName" TEXT,
  "guildId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "lastError" TEXT,
  "deliveryItemsJson" TEXT,
  "metaJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DeliveryDeadLetter_createdAt_idx" ON "DeliveryDeadLetter"("createdAt");
CREATE INDEX "DeliveryDeadLetter_updatedAt_idx" ON "DeliveryDeadLetter"("updatedAt");
