CREATE TABLE "report_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"filters" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_views" ADD CONSTRAINT "report_views_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_views" ADD CONSTRAINT "report_views_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_views_owner_name_idx" ON "report_views" USING btree ("company_id","owner_id",lower("name"));