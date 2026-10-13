CREATE TABLE "magic_link_claim" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
