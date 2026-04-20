CREATE TABLE IF NOT EXISTS "admin_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mfa_secret" text,
	"mfa_enabled" text DEFAULT 'false',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
