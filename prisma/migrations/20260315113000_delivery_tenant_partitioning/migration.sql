ALTER TABLE "Purchase" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Purchase_tenantId_createdAt_idx" ON "Purchase"("tenantId", "createdAt");

ALTER TABLE "DeliveryAudit" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "DeliveryAudit_tenantId_createdAt_idx" ON "DeliveryAudit"("tenantId", "createdAt");

ALTER TABLE "DeliveryQueueJob" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "DeliveryQueueJob_tenantId_updatedAt_idx" ON "DeliveryQueueJob"("tenantId", "updatedAt");

ALTER TABLE "DeliveryDeadLetter" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "DeliveryDeadLetter_tenantId_updatedAt_idx" ON "DeliveryDeadLetter"("tenantId", "updatedAt");
