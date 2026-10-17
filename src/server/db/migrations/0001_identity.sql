CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	CONSTRAINT "invitation_member_role" CHECK ("invitation"."role" IS NULL OR "invitation"."role" = 'member')
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_role_valid" CHECK ("member"."role" IN ('owner','member'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_email_normalized" CHECK ("user"."email" = lower(btrim("user"."email")))
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'ru-RU' NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"personal_owner_id" text,
	"organization_id" text,
	"family_owner_id" text,
	"timezone" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "workspace_kind_valid" CHECK (("workspace"."kind" = 'personal' AND "workspace"."personal_owner_id" IS NOT NULL AND "workspace"."organization_id" IS NULL AND "workspace"."family_owner_id" IS NULL AND "workspace"."deleted_at" IS NULL AND "workspace"."deleted_by" IS NULL) OR ("workspace"."kind" = 'family' AND "workspace"."personal_owner_id" IS NULL AND "workspace"."organization_id" IS NOT NULL AND "workspace"."family_owner_id" IS NOT NULL AND "workspace"."timezone" IS NOT NULL)),
	CONSTRAINT "workspace_deleted_pair" CHECK (("workspace"."deleted_at" IS NULL) = ("workspace"."deleted_by" IS NULL)),
	CONSTRAINT "workspace_version_positive" CHECK ("workspace"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_personal_owner_id_user_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_family_owner_id_user_id_fk" FOREIGN KEY ("family_owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_unique" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_one_owner" ON "member" USING btree ("organization_id") WHERE "member"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "organization_slug_idx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_personal_owner" ON "workspace" USING btree ("personal_owner_id") WHERE "workspace"."kind" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_organization" ON "workspace" USING btree ("organization_id");--> statement-breakpoint
CREATE FUNCTION check_family_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w record; old_org text; new_org text;
BEGIN
 old_org := to_jsonb(OLD)->>'organization_id'; new_org := to_jsonb(NEW)->>'organization_id';
 FOR w IN SELECT * FROM workspace WHERE kind='family' AND organization_id IN (old_org,new_org) LOOP
  IF (SELECT count(*) FROM member WHERE organization_id=w.organization_id AND role='owner') <> 1
    OR NOT EXISTS (SELECT 1 FROM member WHERE organization_id=w.organization_id AND role='owner' AND user_id=w.family_owner_id)
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='family_owner_invariant'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_owner_check AFTER INSERT OR UPDATE OR DELETE ON workspace DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_family_ownership();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER member_owner_check AFTER INSERT OR UPDATE OR DELETE ON member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_family_ownership();
