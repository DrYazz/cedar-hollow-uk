-- The honey page's own counts, for the Honey tab of the private page at
-- /wdtcf (see HONEY_PATH in worker/index.js): per London day, kind (scan,
-- on, next, out) and target (the page or link a visit went on to; '' for a
-- scan or an "on"), how many. Nothing that tells one visitor from another.
--
-- The Worker makes this table itself the first time it is wanted, so this
-- need not be applied by hand; it is here so the database's tables are all
-- written down in one place.
CREATE TABLE IF NOT EXISTS honey (
  day    TEXT    NOT NULL,
  kind   TEXT    NOT NULL,
  target TEXT    NOT NULL DEFAULT '',
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, target)
);
