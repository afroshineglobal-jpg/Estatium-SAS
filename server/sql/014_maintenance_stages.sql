-- 014: richer maintenance request stages, person allocated, expected date and a resident-visible timeline.
-- (ALTER TYPE ... ADD VALUE: each statement commits on its own, so it runs outside a transaction.)
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED' AFTER 'OPEN';
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PARTS' AFTER 'IN_PROGRESS';
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'FIXED' AFTER 'AWAITING_PARTS';
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'REJECTED' AFTER 'CLOSED';
ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "assigneeName" TEXT;
ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "expectedDate" TIMESTAMP(3);
ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "timeline"     JSONB;
