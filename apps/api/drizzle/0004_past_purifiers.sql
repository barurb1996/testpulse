CREATE TABLE IF NOT EXISTS "scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"name" text NOT NULL,
	"classname" text,
	"status" text NOT NULL,
	"duration_ms" integer,
	"failure_message" text,
	"failure_detail" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
