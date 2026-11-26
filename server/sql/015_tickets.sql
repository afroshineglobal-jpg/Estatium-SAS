-- 015: feedback / improvement tickets raised by estate users and answered by the platform owner.
-- Platform tables (no row-level security): the platform console reads across estates; the estate API always filters by tenantId AND userId.
BEGIN;
CREATE TABLE IF NOT EXISTS "Ticket" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "userId"            TEXT NOT NULL,
  "userName"          TEXT NOT NULL,
  "userRole"          TEXT,
  "unitLabel"         TEXT,
  "category"          TEXT NOT NULL DEFAULT 'IDEA',
  "subject"           TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'OPEN',
  "unreadForPlatform" BOOLEAN NOT NULL DEFAULT TRUE,
  "unreadForUser"     BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastMessageAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "Ticket_status_check" CHECK ("status" IN ('OPEN','IN_REVIEW','PLANNED','DONE','CLOSED')),
  CONSTRAINT "Ticket_category_check" CHECK ("category" IN ('IDEA','PROBLEM','QUESTION','OTHER'))
);
CREATE INDEX IF NOT EXISTS "Ticket_tenantId_userId_idx" ON "Ticket" ("tenantId", "userId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "Ticket_status_lastMessageAt_idx" ON "Ticket" ("status", "lastMessageAt" DESC);

CREATE TABLE IF NOT EXISTS "TicketMessage" (
  "id"           TEXT PRIMARY KEY,
  "ticketId"     TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,
  "fromPlatform" BOOLEAN NOT NULL DEFAULT FALSE,
  "authorName"   TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage" ("ticketId", "createdAt");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatium_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "Ticket", "TicketMessage" TO estatium_app;
  END IF;
END $$;
COMMIT;
