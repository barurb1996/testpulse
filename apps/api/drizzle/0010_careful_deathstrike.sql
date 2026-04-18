ALTER TABLE "projects" ADD COLUMN "repo_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_token" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_branch" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "test_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "app_code_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "junit_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_scan_at" timestamp with time zone;