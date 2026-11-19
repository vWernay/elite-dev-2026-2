CREATE TYPE "public"."wallet_entry_kind" AS ENUM('opening', 'deposit', 'lot_debit', 'lot_credit', 'adjustment');--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "wallet_entry_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"lot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_entries_amount_nonzero" CHECK ("wallet_entries"."amount_cents" <> 0),
	CONSTRAINT "wallet_entries_balance_non_negative" CHECK ("wallet_entries"."balance_after_cents" >= 0),
	CONSTRAINT "wallet_entries_sign_by_kind" CHECK (("wallet_entries"."kind" in ('opening', 'deposit', 'lot_credit') and "wallet_entries"."amount_cents" > 0)
        or ("wallet_entries"."kind" = 'lot_debit' and "wallet_entries"."amount_cents" < 0)
        or "wallet_entries"."kind" = 'adjustment')
);
--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_entries_user_idx" ON "wallet_entries" USING btree ("user_id","id" desc);--> statement-breakpoint
-- Saldos que já existiam viram uma linha de abertura, para a soma do extrato bater com o saldo
INSERT INTO "wallet_entries" ("user_id", "kind", "amount_cents", "balance_after_cents")
SELECT "id", 'opening', "balance_cents", "balance_cents" FROM "users" WHERE "balance_cents" > 0;--> statement-breakpoint
-- O extrato é só de inserção
CREATE FUNCTION "wallet_entries_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_entries é só de inserção (% não é permitido)', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "wallet_entries_no_update_delete"
BEFORE UPDATE OR DELETE ON "wallet_entries"
FOR EACH ROW EXECUTE FUNCTION "wallet_entries_append_only"();
