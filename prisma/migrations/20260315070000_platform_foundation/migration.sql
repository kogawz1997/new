-- Add platform foundation tables for billing, licensing, tenant API, agent runtime,
-- and marketplace features without touching non-Prisma operational tables.

CREATE TABLE IF NOT EXISTS "PlatformTenant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'direct',
  "status" TEXT NOT NULL DEFAULT 'active',
  "locale" TEXT NOT NULL DEFAULT 'th',
  "ownerName" TEXT,
  "ownerEmail" TEXT,
  "parentTenantId" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformTenant_slug_key"
  ON "PlatformTenant"("slug");
CREATE INDEX IF NOT EXISTS "PlatformTenant_status_updatedAt_idx"
  ON "PlatformTenant"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformTenant_type_updatedAt_idx"
  ON "PlatformTenant"("type", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformTenant_parentTenantId_idx"
  ON "PlatformTenant"("parentTenantId");

CREATE TABLE IF NOT EXISTS "PlatformSubscription" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
  "status" TEXT NOT NULL DEFAULT 'active',
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "renewsAt" DATETIME,
  "canceledAt" DATETIME,
  "externalRef" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PlatformSubscription_tenantId_updatedAt_idx"
  ON "PlatformSubscription"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformSubscription_status_renewsAt_idx"
  ON "PlatformSubscription"("status", "renewsAt");

CREATE TABLE IF NOT EXISTS "PlatformLicense" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "licenseKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "seats" INTEGER NOT NULL DEFAULT 1,
  "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  "legalDocVersion" TEXT,
  "legalAcceptedAt" DATETIME,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformLicense_licenseKey_key"
  ON "PlatformLicense"("licenseKey");
CREATE INDEX IF NOT EXISTS "PlatformLicense_tenantId_updatedAt_idx"
  ON "PlatformLicense"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformLicense_status_expiresAt_idx"
  ON "PlatformLicense"("status", "expiresAt");

CREATE TABLE IF NOT EXISTS "PlatformApiKey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopesJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastUsedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PlatformApiKey_tenantId_updatedAt_idx"
  ON "PlatformApiKey"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformApiKey_status_updatedAt_idx"
  ON "PlatformApiKey"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformApiKey_keyPrefix_idx"
  ON "PlatformApiKey"("keyPrefix");

CREATE TABLE IF NOT EXISTS "PlatformWebhookEndpoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "secretValue" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT 1,
  "lastSuccessAt" DATETIME,
  "lastFailureAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PlatformWebhookEndpoint_tenantId_updatedAt_idx"
  ON "PlatformWebhookEndpoint"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformWebhookEndpoint_eventType_updatedAt_idx"
  ON "PlatformWebhookEndpoint"("eventType", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformWebhookEndpoint_enabled_updatedAt_idx"
  ON "PlatformWebhookEndpoint"("enabled", "updatedAt");

CREATE TABLE IF NOT EXISTS "PlatformAgentRuntime" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "runtimeKey" TEXT NOT NULL,
  "channel" TEXT,
  "version" TEXT NOT NULL,
  "minRequiredVersion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'online',
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metaJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformAgentRuntime_tenantId_runtimeKey_key"
  ON "PlatformAgentRuntime"("tenantId", "runtimeKey");
CREATE INDEX IF NOT EXISTS "PlatformAgentRuntime_tenantId_updatedAt_idx"
  ON "PlatformAgentRuntime"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformAgentRuntime_status_updatedAt_idx"
  ON "PlatformAgentRuntime"("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "PlatformMarketplaceOffer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'service',
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "status" TEXT NOT NULL DEFAULT 'active',
  "locale" TEXT NOT NULL DEFAULT 'th',
  "metaJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PlatformMarketplaceOffer_tenantId_updatedAt_idx"
  ON "PlatformMarketplaceOffer"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlatformMarketplaceOffer_status_updatedAt_idx"
  ON "PlatformMarketplaceOffer"("status", "updatedAt");
