-- Read-only. Lists accounts with more than one credential (password) row:
-- the accounts migration 0015 refuses to index. Rows without a password
-- beside one with a password are removed by 0015 itself; an account listed
-- with rows_with_password = 2 needs a person to decide which password to
-- keep, with the student, before 0015 runs again.
SELECT
  "user_id",
  count(*)::int AS credential_rows,
  (count(*) FILTER (WHERE coalesce("password", '') <> ''))::int AS rows_with_password
FROM "account"
WHERE "provider_id" = 'credential'
GROUP BY "user_id"
HAVING count(*) > 1
ORDER BY "user_id";
