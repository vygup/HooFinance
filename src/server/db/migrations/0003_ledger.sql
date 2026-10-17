CREATE TABLE "action_revision" (
	"action_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"actor_id" text NOT NULL,
	"happened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	CONSTRAINT "action_revision_action_id_revision_no_pk" PRIMARY KEY("action_id","revision_no"),
	CONSTRAINT "revision_positive" CHECK ("action_revision"."revision_no">0),
	CONSTRAINT "revision_status" CHECK ("action_revision"."status" IN ('active','deleted'))
);
--> statement-breakpoint
CREATE TABLE "command_receipt" (
	"actor_id" text NOT NULL,
	"operation_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"action_id" uuid,
	"result_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipt_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation_key"),
	CONSTRAINT "receipt_status" CHECK ("command_receipt"."status" IN ('pending','completed'))
);
--> statement-breakpoint
CREATE TABLE "financial_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"kind" text NOT NULL,
	"current_revision" integer NOT NULL,
	"status" text NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_kind" CHECK ("financial_action"."kind" IN ('income','expense','transfer')),
	CONSTRAINT "action_status" CHECK ("financial_action"."status" IN ('active','deleted')),
	CONSTRAINT "action_version" CHECK ("financial_action"."version">0 AND "financial_action"."current_revision">0)
);
--> statement-breakpoint
CREATE TABLE "ledger_leg" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text NOT NULL,
	"financial_date" date NOT NULL,
	"category_id" uuid,
	"private_description" text,
	CONSTRAINT "leg_action_revision_role" UNIQUE("action_id","revision_no","role"),
	CONSTRAINT "leg_money" CHECK ("ledger_leg"."amount">0 AND "ledger_leg"."amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
	CONSTRAINT "leg_role_category" CHECK (("ledger_leg"."role" IN ('income','expense') AND "ledger_leg"."category_id" IS NOT NULL) OR ("ledger_leg"."role" IN ('transfer_out','transfer_in') AND "ledger_leg"."category_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "scoped_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_no" integer NOT NULL,
	"before_scope" jsonb,
	"after_scope" jsonb,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_detail" (
	"action_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"source_leg_id" uuid NOT NULL,
	"destination_leg_id" uuid NOT NULL,
	"rate_numerator" numeric NOT NULL,
	"rate_denominator" numeric NOT NULL,
	"rate_decimal" numeric NOT NULL,
	"rate_direction" text NOT NULL,
	CONSTRAINT "transfer_detail_action_id_revision_no_pk" PRIMARY KEY("action_id","revision_no"),
	CONSTRAINT "transfer_positive_finite" CHECK ("transfer_detail"."rate_numerator">0 AND "transfer_detail"."rate_denominator">0 AND "transfer_detail"."rate_decimal">0 AND "transfer_detail"."rate_numerator" NOT IN ('NaN'::numeric,'Infinity'::numeric) AND "transfer_detail"."rate_denominator" NOT IN ('NaN'::numeric,'Infinity'::numeric) AND "transfer_detail"."rate_decimal" NOT IN ('NaN'::numeric,'Infinity'::numeric)),
	CONSTRAINT "transfer_distinct_legs" CHECK ("transfer_detail"."source_leg_id" <> "transfer_detail"."destination_leg_id")
);
--> statement-breakpoint
ALTER TABLE "action_revision" ADD CONSTRAINT "action_revision_action_id_financial_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."financial_action"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_revision" ADD CONSTRAINT "action_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipt" ADD CONSTRAINT "command_receipt_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipt" ADD CONSTRAINT "command_receipt_action_id_financial_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."financial_action"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_action" ADD CONSTRAINT "financial_action_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_leg" ADD CONSTRAINT "ledger_leg_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_leg" ADD CONSTRAINT "leg_revision_fk" FOREIGN KEY ("action_id","revision_no") REFERENCES "public"."action_revision"("action_id","revision_no") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_leg" ADD CONSTRAINT "leg_scope_account_fk" FOREIGN KEY ("workspace_id","account_id","currency") REFERENCES "public"."financial_account"("workspace_id","id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_leg" ADD CONSTRAINT "leg_scope_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."category"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoped_audit_event" ADD CONSTRAINT "scoped_audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoped_audit_event" ADD CONSTRAINT "scoped_audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_detail" ADD CONSTRAINT "transfer_detail_source_leg_id_ledger_leg_id_fk" FOREIGN KEY ("source_leg_id") REFERENCES "public"."ledger_leg"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_detail" ADD CONSTRAINT "transfer_detail_destination_leg_id_ledger_leg_id_fk" FOREIGN KEY ("destination_leg_id") REFERENCES "public"."ledger_leg"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_detail" ADD CONSTRAINT "transfer_detail_action_id_revision_no_action_revision_action_id_revision_no_fk" FOREIGN KEY ("action_id","revision_no") REFERENCES "public"."action_revision"("action_id","revision_no") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leg_scope_date" ON "ledger_leg" USING btree ("workspace_id","financial_date","id");--> statement-breakpoint
CREATE INDEX "leg_scope_account_date" ON "ledger_leg" USING btree ("workspace_id","account_id","financial_date");--> statement-breakpoint
CREATE INDEX "leg_scope_category_date" ON "ledger_leg" USING btree ("workspace_id","category_id","financial_date");--> statement-breakpoint
CREATE INDEX "audit_scope_date" ON "scoped_audit_event" USING btree ("workspace_id","occurred_at","id");--> statement-breakpoint
ALTER TABLE financial_action ADD CONSTRAINT action_current_revision_fk FOREIGN KEY (id,current_revision) REFERENCES action_revision(action_id,revision_no) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_history'; END $$;
--> statement-breakpoint
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON action_revision FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER leg_immutable BEFORE UPDATE OR DELETE ON ledger_leg FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER transfer_detail_immutable BEFORE UPDATE OR DELETE ON transfer_detail FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION check_ledger_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a financial_action%ROWTYPE; r action_revision%ROWTYPE; src ledger_leg%ROWTYPE; dst ledger_leg%ROWTYPE; d transfer_detail%ROWTYPE; action_key uuid; count_legs integer;
BEGIN
 action_key:=COALESCE((to_jsonb(NEW)->>'action_id')::uuid,(to_jsonb(OLD)->>'action_id')::uuid,(to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
 SELECT * INTO a FROM financial_action WHERE id=action_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM action_revision WHERE action_id=a.id AND revision_no=a.current_revision;
 IF NOT FOUND OR r.status<>a.status THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='action_revision_mismatch'; END IF;
 SELECT count(*) INTO count_legs FROM ledger_leg WHERE action_id=a.id AND revision_no=a.current_revision;
 IF a.kind='transfer' THEN
  SELECT * INTO src FROM ledger_leg WHERE action_id=a.id AND revision_no=a.current_revision AND role='transfer_out';
  SELECT * INTO dst FROM ledger_leg WHERE action_id=a.id AND revision_no=a.current_revision AND role='transfer_in';
  SELECT * INTO d FROM transfer_detail WHERE action_id=a.id AND revision_no=a.current_revision;
  IF count_legs<>2 OR src.id IS NULL OR dst.id IS NULL OR d.action_id IS NULL OR src.account_id=dst.account_id
   OR d.source_leg_id<>src.id OR d.destination_leg_id<>dst.id OR d.rate_numerator<>src.amount OR d.rate_denominator<>dst.amount
   OR (src.currency=dst.currency AND src.amount<>dst.amount)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='transfer_invariant'; END IF;
 ELSE
  IF count_legs<>1 OR NOT EXISTS(SELECT 1 FROM ledger_leg WHERE action_id=a.id AND revision_no=a.current_revision AND role=a.kind)
   OR EXISTS(SELECT 1 FROM transfer_detail WHERE action_id=a.id AND revision_no=a.current_revision)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='action_leg_invariant'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM ledger_leg l JOIN category c ON c.workspace_id=l.workspace_id AND c.id=l.category_id WHERE l.action_id=a.id AND l.revision_no=a.current_revision AND c.kind<>l.role)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='category_kind_mismatch'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER action_integrity AFTER INSERT OR UPDATE ON financial_action DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER revision_integrity AFTER INSERT ON action_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER leg_integrity AFTER INSERT ON ledger_leg DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transfer_integrity AFTER INSERT ON transfer_detail DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_revision();
