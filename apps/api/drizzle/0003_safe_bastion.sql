CREATE TABLE IF NOT EXISTS "gap_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"title" text NOT NULL,
	"rationale" text,
	"severity" text NOT NULL,
	"steps" jsonb NOT NULL,
	"endpoint_hash" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gap_suggestions" ADD CONSTRAINT "gap_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gap_suggestions" ADD CONSTRAINT "gap_suggestions_target_id_coverage_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."coverage_targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
