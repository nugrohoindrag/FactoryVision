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
--
--
-- PORTED FROM POSTGRESQL. Three differences worth knowing before editing:
--
--  1. One PL/pgSQL function served both tables and both operations. MySQL has
--     no shared trigger body and no `BEFORE UPDATE OR DELETE`, so the same rule
--     is spelled out four times. They must be kept identical by hand.
--  2. `RAISE EXCEPTION ... USING ERRCODE = 'restrict_violation'` becomes
--     `SIGNAL SQLSTATE '45000'`, MySQL's only user-raisable state. MESSAGE_TEXT
--     is silently TRUNCATED past 128 characters, so these messages are written
--     to fit — do not lengthen them without counting.
--  3. `current_setting('factoryvision.allow_log_delete', true)` becomes the
--     user variable `@fv_allow_log_delete`. This is the leaky one: Postgres
--     scoped it to the transaction, MySQL scopes it to the CONNECTION. Nothing
--     in the database clears it, so `withLogDeleteAllowed()` in
--     `src/common/append-only.ts` must — and it is the only thing that does.
--     Never set this variable anywhere else.
--
-- `<=>` is the NULL-safe equality operator: an unset variable is NULL, and
-- `NULL <=> 'on'` is false rather than NULL, so the guard holds closed by
-- default instead of evaluating to unknown and letting the row through.
--
--
-- ONE HOLE, MEASURED AND KNOWINGLY ACCEPTED.
--
-- MySQL does not fire row triggers for rows removed by a foreign-key CASCADE;
-- PostgreSQL does. Verified against 8.0.46, not assumed: deleting a `tenant`
-- row took its two `event` rows with it and no trigger objected, with no flag
-- set.
--
-- So on MySQL the log is protected against direct UPDATE and direct DELETE —
-- which is every path the product actually takes, including the history-import
-- revert in `history-import.service.ts`, where the flag really is what lets the
-- delete through — but NOT against `DELETE FROM tenant`. On PostgreSQL that
-- path was gated too.
--
-- Accepted because the only caller is `OpsService.deleteTenant`, which is bound
-- to no route, runs from a console, and demands the factory's exact name first.
-- The cost of the gap is that the last line of defence there is now that
-- procedure rather than the database. Worth re-reading when the customer
-- deletion flow stops being console-only, and gone the moment this schema
-- returns to PostgreSQL.

DROP TRIGGER IF EXISTS `event_append_only_update`;
CREATE TRIGGER `event_append_only_update`
BEFORE UPDATE ON `event`
FOR EACH ROW
BEGIN
  IF NOT (@fv_allow_log_delete <=> 'on') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'event is append-only. Correct a mistake with a new entry, never by editing this one.';
  END IF;
END;

DROP TRIGGER IF EXISTS `event_append_only_delete`;
CREATE TRIGGER `event_append_only_delete`
BEFORE DELETE ON `event`
FOR EACH ROW
BEGIN
  IF NOT (@fv_allow_log_delete <=> 'on') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'event is append-only. Correct a mistake with a new entry, never by deleting this one.';
  END IF;
END;

DROP TRIGGER IF EXISTS `admin_audit_append_only_update`;
CREATE TRIGGER `admin_audit_append_only_update`
BEFORE UPDATE ON `admin_audit`
FOR EACH ROW
BEGIN
  IF NOT (@fv_allow_log_delete <=> 'on') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'admin_audit is append-only. Correct a mistake with a new entry, never by editing it.';
  END IF;
END;

DROP TRIGGER IF EXISTS `admin_audit_append_only_delete`;
CREATE TRIGGER `admin_audit_append_only_delete`
BEFORE DELETE ON `admin_audit`
FOR EACH ROW
BEGIN
  IF NOT (@fv_allow_log_delete <=> 'on') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'admin_audit is append-only. Correct a mistake with a new entry, never by deleting it.';
  END IF;
END;

-- B-087 — the indexes the load test leans on.
--
-- 200,000 movements a year per tenant (PRD §10) means the replay query is the
-- one that decides whether a report answers in a second or in a minute.
--
-- MySQL has no `CREATE INDEX IF NOT EXISTS`, so unlike the Postgres original
-- these are plain creates. That is safe here only because this migration runs
-- exactly once against a database the previous migration just built.
CREATE INDEX `event_tenant_occurred_idx` ON `event` (`tenantId`, `occurredAt`);
CREATE INDEX `event_tenant_provenance_idx` ON `event` (`tenantId`, `provenance`);
