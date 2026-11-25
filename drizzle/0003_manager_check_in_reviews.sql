CREATE TABLE "check_in_reviews" (
	"company_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"check_in_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_in_reviews" ADD CONSTRAINT "check_in_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_reviews" ADD CONSTRAINT "check_in_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_reviews" ADD CONSTRAINT "check_in_reviews_check_in_id_kr_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."kr_check_ins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_in_reviews_scope_idx" ON "check_in_reviews" USING btree ("company_id","reviewer_id","check_in_id");