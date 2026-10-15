-- One password (credential row) per account. Password writes go through
-- DeviceStore.writeCredential (src/server/auth/device-grants.ts); this index
-- refuses a second credential row even from a path that skips it.
--
-- First removes a credential row with no password when the same account has
-- another credential row with one. Such a row can't sign anyone in, and
-- better-auth 1.5.5 ignores it when checking for an existing password.
-- Then fails, changing nothing (the removal is undone too), if any account
-- still has two credential rows: which password to keep is a decision about
-- a student's account, so a person makes it before this runs again.
-- scripts/db/duplicate-credentials.sql lists those accounts.
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
  -- This block is one statement, so the removal and the refusal commit or
  -- roll back together even when psql runs it outside a transaction.
  DELETE FROM "account" AS blank
  WHERE blank."provider_id" = 'credential' AND coalesce(blank."password", '') = ''
    AND EXISTS (
      SELECT 1 FROM "account" AS other
      WHERE other."user_id" = blank."user_id" AND other."provider_id" = 'credential'
        AND other."id" <> blank."id" AND coalesce(other."password", '') <> ''
    );
  SELECT count(*) INTO duplicated FROM (
    SELECT "user_id" FROM "account" WHERE "provider_id" = 'credential' GROUP BY "user_id" HAVING count(*) > 1
  ) AS accounts_with_two;
  IF duplicated > 0 THEN
    RAISE EXCEPTION '% account(s) still have more than one credential row; list them with scripts/db/duplicate-credentials.sql and resolve them by hand before migration 0015', duplicated;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_credential_user_idx" ON "account" USING btree ("user_id") WHERE "account"."provider_id" = 'credential';
--> statement-breakpoint
RESET lock_timeout;
