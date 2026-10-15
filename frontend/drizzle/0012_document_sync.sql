CREATE TABLE "documents" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"institution_id" text NOT NULL,
	"revision" integer NOT NULL,
	"body" jsonb,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "documents_kind" CHECK ("documents"."kind" in ('academic-record', 'schedule', 'preferences')),
	CONSTRAINT "documents_revision" CHECK ("documents"."revision" > 0),
	CONSTRAINT "documents_tombstone" CHECK ("documents"."deleted" = ("documents"."body" is null))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"write_sha256" text NOT NULL,
	"committed_revision" integer NOT NULL,
	CONSTRAINT "receipts_user_id_operation_id_pk" PRIMARY KEY("user_id","operation_id"),
	CONSTRAINT "receipts_hash" CHECK ("receipts"."write_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipts_revision" CHECK ("receipts"."committed_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"institution_id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"reason" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "versions_reason" CHECK ("versions"."reason" in ('before-auto', 'restore-point', 'import'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "versions_user_created_idx" ON "versions" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "versions_schedule_created_idx" ON "versions" USING btree ("user_id","schedule_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- A version survives ordinary document deletes. Account deletion may cascade it.
CREATE FUNCTION reject_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM "user" WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'versions are append-only' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER versions_append_only BEFORE UPDATE OR DELETE ON versions
FOR EACH ROW EXECUTE FUNCTION reject_version_mutation();
