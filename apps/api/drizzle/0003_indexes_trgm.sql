CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "bids_bidder_lot_idx" ON "bids" USING btree ("bidder_id","lot_id");--> statement-breakpoint
CREATE INDEX "lots_auctioneer_created_idx" ON "lots" USING btree ("auctioneer_id","created_at" desc,"id");--> statement-breakpoint
CREATE INDEX "lots_showcase_created_idx" ON "lots" USING btree ("created_at" desc,"id") WHERE "lots"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "lots_showcase_ends_idx" ON "lots" USING btree ("ends_at","id") WHERE "lots"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "lots_title_trgm_idx" ON "lots" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lots_set_trgm_idx" ON "lots" USING gin (("attributes"->>'set') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "receipts_winner_idx" ON "receipts" USING btree ("winner_id");