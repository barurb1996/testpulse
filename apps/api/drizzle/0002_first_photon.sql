CREATE TABLE IF NOT EXISTS "coverage_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"path" text NOT NULL,
	"operation_id" text,
	"summary" text,
	"domain" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"path" text NOT NULL,
	"file" text,
	"line" integer,
	"scenario_name" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coverage_targets" ADD CONSTRAINT "coverage_targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_endpoints" ADD CONSTRAINT "run_endpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
