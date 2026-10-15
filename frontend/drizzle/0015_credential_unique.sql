-- One password (credential row) per account. Password writes go through
-- DeviceStore.writeCredential (src/server/auth/device-grants.ts); this index
-- refuses a second credential row even from a path that skips it.
--
-- Fails, changing nothing, if any account already has two credential rows:
-- which one to keep is a decision about a student's password, so a person
-- makes it before this runs again.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction, and drizzle's
-- migrator runs migrations in one. The plain CREATE UNIQUE INDEX blocks
-- writes to "account" while it builds. lock_timeout makes the migration
-- fail instead of queueing behind a long transaction while every sign-in
-- queues behind it. 5 seconds is an unmeasured starting value. It is set
-- for the session, not LOCAL, because CI applies each file with psql
-- outside a transaction; the RESET at the end restores it.
SET lock_timeout = '5s';
--> statement-breakpoint
DO $$
DECLARE
  duplicated integer;
BEGIN
  SELECT count(*) INTO duplicated FROM (
    SELECT "user_id" FROM "account" WHERE "provider_id" = 'credential' GROUP BY "user_id" HAVING count(*) > 1
  ) AS accounts_with_two;
  IF duplicated > 0 THEN
    RAISE EXCEPTION '% account(s) have more than one credential row; resolve them by hand before migration 0015', duplicated;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_credential_user_idx" ON "account" USING btree ("user_id") WHERE "account"."provider_id" = 'credential';
--> statement-breakpoint
RESET lock_timeout;
