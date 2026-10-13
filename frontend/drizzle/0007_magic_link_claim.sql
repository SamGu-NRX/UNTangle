CREATE TABLE "magic_link_claim" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
