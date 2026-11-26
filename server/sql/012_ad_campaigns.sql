-- 012_ad_campaigns.sql — platform-level ad campaigns with place/flat targeting, per-estate statistics, and the cross-estate reach function.
-- Ads were one copy per estate; a campaign is ONE record whose targeting is resolved when a resident opens the app, so estates that join
-- later are picked up automatically. Idempotent; additive. (Old per-estate "Advertisement" rows are left in place but no longer shown.)

CREATE TABLE IF NOT EXISTS "AdCampaign" (
  "id"             TEXT PRIMARY KEY,
  "title"          TEXT NOT NULL,
  "content"        TEXT,
  "imageUrl"       TEXT,
  "linkUrl"        TEXT,
  "advertiserName" TEXT,
  "placement"      TEXT NOT NULL DEFAULT 'TOP',          -- TOP | BOTTOM
  "pages"          TEXT,                                 -- NULL = every page, else comma-separated app paths
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'ACTIVE',       -- ACTIVE | STOPPED
  "targeting"      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { everywhere, countries, states, districts, cities, areas, localities, postalCodes, estateIds, flats }
  "impressions"    INTEGER NOT NULL DEFAULT 0,
  "clicks"         INTEGER NOT NULL DEFAULT 0,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AdCampaign_status_dates_idx" ON "AdCampaign" ("status", "startDate", "endDate");

CREATE TABLE IF NOT EXISTS "AdCampaignStat" (
  "campaignId"  TEXT NOT NULL REFERENCES "AdCampaign"("id") ON DELETE CASCADE,
  "tenantId"    TEXT NOT NULL REFERENCES "Tenant"("id"),
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks"      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("campaignId", "tenantId")
);

-- People per occupied flat in every live estate (platform owner view for ad reach). Counts only; no names, no contact details.
CREATE OR REPLACE FUNCTION platform_reach_units()
RETURNS TABLE ("tenantId" text, "unitId" text, residents integer, owners integer, family integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r."tenantId", r."unitId",
         count(*)::int,
         (count(*) FILTER (WHERE r."residentType"::text = 'OWNER'))::int,
         (SELECT count(*)::int FROM "FamilyMember" f WHERE f."tenantId" = r."tenantId" AND f."residentId" IN (SELECT x.id FROM "Resident" x WHERE x."unitId" = r."unitId" AND x."isActive"))
  FROM "Resident" r
  JOIN "Tenant" t ON t.id = r."tenantId" AND t.status::text IN ('TRIAL', 'ACTIVE')
  WHERE r."isActive"
  GROUP BY r."tenantId", r."unitId"
$$;
REVOKE ALL ON FUNCTION platform_reach_units() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatium_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdCampaign", "AdCampaignStat" TO estatium_app;
    GRANT EXECUTE ON FUNCTION platform_reach_units() TO estatium_app;
  END IF;
END $$;
