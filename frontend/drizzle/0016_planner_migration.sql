-- One row per user whose legacy planner_state row has moved into documents
-- (src/lib/document-sync/legacy-migration.ts). The legacy write path in
-- src/app/api/planner/route.ts refuses once it exists.
--
-- The foreign key takes a lock on "user" that blocks sign-ins while it is
-- held. lock_timeout makes the migration fail instead of queueing behind a
-- long transaction with every sign-in queued behind it. 5 seconds is the
-- same unmeasured starting value as 0015, set for the session because CI
-- applies each file with psql outside a transaction.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "planner_migration" (
	"user_id" text PRIMARY KEY NOT NULL,
	"migrated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planner_migration" ADD CONSTRAINT "planner_migration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
RESET lock_timeout;
