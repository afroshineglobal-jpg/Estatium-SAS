-- 010_ads_pages.sql — banners can be limited to chosen pages. NULL = every page; otherwise a comma-separated list of app paths.
-- Placement now means where on the page: TOP | BOTTOM (older rows say HOME and are treated as TOP). Idempotent; additive.
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "pages" TEXT;
