ALTER TABLE "pr_intent" ADD COLUMN "confidence" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "source" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider_used" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model_used" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;