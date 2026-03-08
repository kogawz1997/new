-- CreateTable
CREATE TABLE "Punishment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Giveaway" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "winnersCount" INTEGER NOT NULL DEFAULT 1,
    "endsAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GiveawayEntrant" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("messageId", "userId"),
    CONSTRAINT "GiveawayEntrant_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Giveaway" ("messageId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopPanelMessage" (
    "guildId" TEXT NOT NULL,
    "panelType" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("guildId", "panelType")
);

-- CreateTable
CREATE TABLE "DeliveryAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "purchaseCode" TEXT,
    "itemId" TEXT,
    "userId" TEXT,
    "steamId" TEXT,
    "attempt" INTEGER,
    "message" TEXT NOT NULL,
    "metaJson" TEXT
);

-- CreateIndex
CREATE INDEX "Punishment_userId_createdAt_idx" ON "Punishment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Punishment_type_createdAt_idx" ON "Punishment"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Giveaway_guildId_endsAt_idx" ON "Giveaway"("guildId", "endsAt");

-- CreateIndex
CREATE INDEX "GiveawayEntrant_userId_joinedAt_idx" ON "GiveawayEntrant"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "TopPanelMessage_guildId_updatedAt_idx" ON "TopPanelMessage"("guildId", "updatedAt");

-- CreateIndex
CREATE INDEX "DeliveryAudit_createdAt_idx" ON "DeliveryAudit"("createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAudit_level_createdAt_idx" ON "DeliveryAudit"("level", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAudit_action_createdAt_idx" ON "DeliveryAudit"("action", "createdAt");
