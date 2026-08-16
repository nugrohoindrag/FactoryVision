-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OPERATOR', 'PRODUCTION', 'QC', 'WAREHOUSE_HEAD', 'OWNER');

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "paidUntil" TIMESTAMP(3),

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastEventHash" TEXT,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_request" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "provenance" TEXT NOT NULL DEFAULT 'device',

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incomingEvent" JSONB NOT NULL,
    "serverVersion" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "conflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_line" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "ownerParty" TEXT NOT NULL DEFAULT 'self',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_checkpoint" (
    "tenantId" TEXT NOT NULL,
    "lastEventId" TEXT,
    "lastReceived" TIMESTAMP(3),
    "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventsApplied" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "projection_checkpoint_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "sync_cursor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lastReceived" TIMESTAMP(3),
    "lastEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemClass" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "conversions" JSONB NOT NULL DEFAULT '[]',
    "shelfLifeDays" INTEGER,
    "minimumStock" DECIMAL(24,6),
    "averageCost" DECIMAL(24,6),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "storable" BOOLEAN NOT NULL DEFAULT false,
    "virtual" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "producedOn" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,

    CONSTRAINT "batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_location" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "level" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "production_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "eta" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(24,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(24,6),

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outputQuantity" DECIMAL(24,6) NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_line" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "standardQuantity" DECIMAL(24,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "standardShrinkagePct" DECIMAL(24,6),

    CONSTRAINT "bom_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_config" (
    "tenantId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_config_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "photo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventId" TEXT,

    CONSTRAINT "photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "payload" JSONB NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "note" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_user_tenantId_role_idx" ON "app_user"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE INDEX "device_tenantId_userId_idx" ON "device"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "session_tenantId_userId_idx" ON "session"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "session_refreshTokenHash_idx" ON "session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "otp_request_phone_createdAt_idx" ON "otp_request"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "event_tenantId_receivedAt_id_idx" ON "event"("tenantId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "event_tenantId_deviceId_id_idx" ON "event"("tenantId", "deviceId", "id");

-- CreateIndex
CREATE INDEX "event_tenantId_type_idx" ON "event"("tenantId", "type");

-- CreateIndex
CREATE INDEX "conflict_tenantId_resolvedAt_idx" ON "conflict"("tenantId", "resolvedAt");

-- CreateIndex
CREATE INDEX "stock_line_tenantId_productId_idx" ON "stock_line"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "stock_line_tenantId_locationId_idx" ON "stock_line"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_line_tenantId_productId_batchId_locationId_status_own_key" ON "stock_line"("tenantId", "productId", "batchId", "locationId", "status", "ownerParty");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursor_tenantId_deviceId_key" ON "sync_cursor"("tenantId", "deviceId");

-- CreateIndex
CREATE INDEX "product_tenantId_itemClass_idx" ON "product"("tenantId", "itemClass");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenantId_sku_key" ON "product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "location_tenantId_parentId_idx" ON "location"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "location_tenantId_depth_idx" ON "location"("tenantId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "location_tenantId_code_key" ON "location"("tenantId", "code");

-- CreateIndex
CREATE INDEX "partner_tenantId_kind_idx" ON "partner"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "partner_tenantId_code_key" ON "partner"("tenantId", "code");

-- CreateIndex
CREATE INDEX "batch_tenantId_expiryDate_idx" ON "batch"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "batch_tenantId_productId_batchNo_key" ON "batch"("tenantId", "productId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "production_location_tenantId_code_key" ON "production_location"("tenantId", "code");

-- CreateIndex
CREATE INDEX "purchase_order_tenantId_eta_idx" ON "purchase_order"("tenantId", "eta");

-- CreateIndex
CREATE INDEX "purchase_order_tenantId_supplierId_idx" ON "purchase_order"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_tenantId_poNo_key" ON "purchase_order"("tenantId", "poNo");

-- CreateIndex
CREATE INDEX "purchase_order_line_tenantId_purchaseOrderId_idx" ON "purchase_order_line"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_tenantId_productId_key" ON "bom"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "bom_line_tenantId_bomId_idx" ON "bom_line"("tenantId", "bomId");

-- CreateIndex
CREATE INDEX "photo_tenantId_eventId_idx" ON "photo"("tenantId", "eventId");

-- CreateIndex
CREATE INDEX "photo_tenantId_uploadedAt_idx" ON "photo"("tenantId", "uploadedAt");

-- CreateIndex
CREATE INDEX "push_subscription_tenantId_userId_idx" ON "push_subscription"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "alert_tenantId_clearedAt_idx" ON "alert"("tenantId", "clearedAt");

-- CreateIndex
CREATE UNIQUE INDEX "alert_tenantId_kind_subjectId_key" ON "alert"("tenantId", "kind", "subjectId");

-- CreateIndex
CREATE INDEX "approval_tenantId_decidedAt_idx" ON "approval"("tenantId", "decidedAt");

-- CreateIndex
CREATE INDEX "admin_audit_tenantId_at_idx" ON "admin_audit"("tenantId", "at");

-- CreateIndex
CREATE INDEX "admin_audit_tenantId_subject_subjectId_idx" ON "admin_audit"("tenantId", "subject", "subjectId");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_request" ADD CONSTRAINT "otp_request_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_line" ADD CONSTRAINT "stock_line_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_checkpoint" ADD CONSTRAINT "projection_checkpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursor" ADD CONSTRAINT "sync_cursor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_location" ADD CONSTRAINT "production_location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom" ADD CONSTRAINT "bom_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_config" ADD CONSTRAINT "tenant_config_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
