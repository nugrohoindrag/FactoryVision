-- B-025 / B-085 — the log is append-only, and the DATABASE says so.
--
-- "No code updates this table" is a promise about today's code. It survives
-- exactly until somebody writes a migration script at 2am to fix one wrong
-- quantity, and at that point every hash after it is broken and the audit trail
-- is worthless in the only situation it was ever needed for.
--
-- So the rule is enforced where it cannot be argued with. A correction is a new
-- event; there is no other way in (PRD §8, §10).
--
-- The same applies to `admin_audit`: an audit trail that can be edited is a
-- record of what somebody wanted the history to look like.

CREATE OR REPLACE FUNCTION fv_refuse_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'The % table is append-only. Correct a mistake by recording a new entry, never by editing this one.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_append_only ON "event";
CREATE TRIGGER event_append_only
  BEFORE UPDATE OR DELETE ON "event"
  FOR EACH ROW EXECUTE FUNCTION fv_refuse_mutation();

DROP TRIGGER IF EXISTS admin_audit_append_only ON "admin_audit";
CREATE TRIGGER admin_audit_append_only
  BEFORE UPDATE OR DELETE ON "admin_audit"
  FOR EACH ROW EXECUTE FUNCTION fv_refuse_mutation();

-- One exception, and it is deliberate: dropping a tenant.
--
-- A customer who leaves is entitled to have their data actually removed, and
-- the cascade from `tenant` has to be able to reach these rows. `ALLOW` is set
-- by the deletion routine for the duration of that one transaction and by
-- nothing else.
CREATE OR REPLACE FUNCTION fv_refuse_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('factoryvision.allow_log_delete', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;

  RAISE EXCEPTION
    'The % table is append-only. Correct a mistake by recording a new entry, never by editing this one.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- B-087 — the indexes the load test leans on.
--
-- 200,000 movements a year per tenant (PRD §10) means the replay query is the
-- one that decides whether a report answers in a second or in a minute.
CREATE INDEX IF NOT EXISTS event_tenant_occurred_idx ON "event" ("tenantId", "occurredAt");
CREATE INDEX IF NOT EXISTS event_tenant_provenance_idx ON "event" ("tenantId", "provenance");
