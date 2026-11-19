ALTER TABLE "bids" ADD COLUMN "ends_at_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lots" ADD COLUMN "chain_version" integer DEFAULT 1 NOT NULL;