CREATE TABLE "workers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_jobs" ALTER COLUMN "runner" SET DEFAULT 'local';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "worker_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "worker_token_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workers_user_idx" ON "workers" USING btree ("user_id","last_seen");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_worker_token_hash_unique" UNIQUE("worker_token_hash");