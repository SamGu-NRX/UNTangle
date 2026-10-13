-- Sessions of accounts whose email was never verified were made before password
-- sign-up was turned off (sign-in links create verified accounts). Only an account
-- whose inbox owner hasn't signed in can be in that state, so its sessions go.
DELETE FROM "session" WHERE "user_id" IN (SELECT "id" FROM "user" WHERE "email_verified" = false);
