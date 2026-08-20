ALTER TABLE "eval_runs" ADD COLUMN "run_group_id" uuid;--> statement-breakpoint
CREATE INDEX "eval_runs_run_group_idx" ON "eval_runs" USING btree ("run_group_id");