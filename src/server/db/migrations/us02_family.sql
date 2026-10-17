CREATE TABLE "ownership_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"initiator_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"workspace_version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_offer_status" CHECK ("ownership_offer"."status" IN ('pending','accepted','cancelled')),
	CONSTRAINT "ownership_offer_version" CHECK ("ownership_offer"."workspace_version">0),
	CONSTRAINT "ownership_offer_distinct" CHECK ("ownership_offer"."initiator_id"<>"ownership_offer"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "ownership_offer" ADD CONSTRAINT "ownership_offer_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_offer" ADD CONSTRAINT "ownership_offer_initiator_id_user_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_offer" ADD CONSTRAINT "ownership_offer_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ownership_offer_scope" ON "ownership_offer" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE FUNCTION check_ownership_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='pending' AND NOT EXISTS (
 SELECT 1 FROM workspace w JOIN member m ON m.organization_id=w.organization_id
 WHERE w.id=NEW.workspace_id AND w.kind='family' AND w.deleted_at IS NULL
 AND w.family_owner_id=NEW.initiator_id AND w.version=NEW.workspace_version
 AND m.user_id=NEW.recipient_id AND m.role='member'
 ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='ownership_offer_recipient'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ownership_offer_recipient_check BEFORE INSERT OR UPDATE ON ownership_offer FOR EACH ROW EXECUTE FUNCTION check_ownership_offer();
