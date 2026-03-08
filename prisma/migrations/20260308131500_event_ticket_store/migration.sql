-- CreateTable
CREATE TABLE "GuildEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "reward" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GuildEventParticipant" (
    "eventId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("eventId", "userId"),
    CONSTRAINT "GuildEventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GuildEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketRecord" (
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "id" INTEGER NOT NULL,
    "guildId" TEXT,
    "userId" TEXT,
    "category" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "GuildEvent_status_updatedAt_idx" ON "GuildEvent"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "GuildEventParticipant_userId_joinedAt_idx" ON "GuildEventParticipant"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "TicketRecord_status_updatedAt_idx" ON "TicketRecord"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TicketRecord_guildId_status_idx" ON "TicketRecord"("guildId", "status");
