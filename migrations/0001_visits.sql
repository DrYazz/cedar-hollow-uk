-- Where visits come from, for the private map at /wdtcf (see VISIT_PATH in
-- worker/index.js). One row per London day, part of the site and town: how
-- many visits Cloudflare placed there. Nothing that tells one visitor from
-- another is kept -- no address, no visit id, no time of day.
--
-- part is "all" for every visit, once; "oxford" or "dorset" for a visit that
-- reached that woodland's pages, once each.
--
-- Applied with:
--   npx wrangler d1 migrations apply cedar-hollow-visits --remote
CREATE TABLE visits (
  day     TEXT    NOT NULL,            -- YYYY-MM-DD, London time
  part    TEXT    NOT NULL,            -- all | oxford | dorset
  country TEXT    NOT NULL,            -- ISO 3166 code, as Cloudflare gives it
  region  TEXT    NOT NULL DEFAULT '',
  city    TEXT    NOT NULL DEFAULT '',
  lat     REAL,                        -- the town's position, to 2 places
  lon     REAL,
  visits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, part, country, region, city)
);

-- The map reads one part over a run of days.
CREATE INDEX visits_part_day ON visits (part, day);
