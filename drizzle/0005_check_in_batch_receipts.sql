CREATE TABLE "check_in_batch_receipts" (
	"company_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"digest" varchar(64) NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_in_batch_receipts" ADD CONSTRAINT "check_in_batch_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_batch_receipts" ADD CONSTRAINT "check_in_batch_receipts_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_in_batch_receipts_scope_idx" ON "check_in_batch_receipts" USING btree ("company_id","actor_id","request_id");