CREATE TYPE "public"."user_role" AS ENUM('auctioneer', 'bidder');--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"mac" text NOT NULL,
	CONSTRAINT "bids_lot_seq_unique" UNIQUE("lot_id","seq")
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auctioneer_id" uuid NOT NULL,
	"scryfall_id" text NOT NULL,
	"title" text NOT NULL,
	"image_url" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"starting_bid_cents" bigint NOT NULL,
	"min_increment_cents" bigint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"original_ends_at" timestamp with time zone NOT NULL,
	"current_bid_cents" bigint,
	"leader_id" uuid,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"head_mac" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_starting_bid_positive" CHECK ("lots"."starting_bid_cents" > 0),
	CONSTRAINT "lots_min_increment_positive" CHECK ("lots"."min_increment_cents" > 0),
	CONSTRAINT "lots_schedule_valid" CHECK ("lots"."ends_at" > "lots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"winner_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"chain_mac" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_lot_id_unique" UNIQUE("lot_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_balance_non_negative" CHECK ("users"."balance_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_auctioneer_id_users_id_fk" FOREIGN KEY ("auctioneer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lots_schedule_idx" ON "lots" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "lots_leader_idx" ON "lots" USING btree ("leader_id");--> statement-breakpoint
CREATE INDEX "lots_pending_settlement_idx" ON "lots" USING btree ("ends_at") WHERE "lots"."settled_at" is null and "lots"."cancelled_at" is null;