-- Read-only. Lists accounts with more than one credential (password) row.
-- Migration 0015 fails while any of them is left after its own cleanup. That
-- cleanup removes rows without a password from an account that has a row with
-- one, so an account with rows_with_password = 1 needs no person. When 0015
-- fails, it rolls that cleanup back too, so those accounts still show here
-- until a run succeeds. Every other listed account needs a person before 0015 runs again: with
-- rows_with_password >= 2, decide with the student which password to keep;
-- with rows_with_password = 0, keep one empty row and delete the rest.
SELECT
  "user_id",
  count(*)::int AS credential_rows,
  (count(*) FILTER (WHERE coalesce("password", '') <> ''))::int AS rows_with_password
FROM "account"
WHERE "provider_id" = 'credential'
GROUP BY "user_id"
HAVING count(*) > 1
ORDER BY "user_id";
