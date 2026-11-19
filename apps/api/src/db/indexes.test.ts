import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { db } from "./client.js"

// Com poucos dados o planner prefere varrer a tabela; desligar o seq scan
// mostra se o índice atende a consulta.
async function planWithoutSeqScan(query: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`)
    const result = await tx.execute(sql.raw(`explain ${query}`))
    return result.rows.map((row) => String(row["QUERY PLAN"])).join("\n")
  })
}

describe("índices das listagens", () => {
  it("existem todos os índices esperados e a extensão pg_trgm", async () => {
    const result = await db.execute(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    )
    const names = result.rows.map((row) => row.indexname)
    expect(names).toEqual(
      expect.arrayContaining([
        "bids_bidder_lot_idx",
        "lots_auctioneer_created_idx",
        "lots_showcase_created_idx",
        "lots_showcase_ends_idx",
        "lots_title_trgm_idx",
        "lots_set_trgm_idx",
        "receipts_winner_idx",
      ]),
    )
    const ext = await db.execute(
      sql`select 1 from pg_extension where extname = 'pg_trgm'`,
    )
    expect(ext.rows).toHaveLength(1)
  })

  it("a busca por texto usa os índices trigram", async () => {
    const plan = await planWithoutSeqScan(
      `select * from lots where title ilike '%lotus%' or attributes->>'set' ilike '%lotus%'`,
    )
    expect(plan).toContain("lots_title_trgm_idx")
    expect(plan).toContain("lots_set_trgm_idx")
  })

  it("'Meus arremates' usa o índice de lances por licitante", async () => {
    const plan = await planWithoutSeqScan(
      `select lot_id, max(amount_cents) from bids
       where bidder_id = '00000000-0000-4000-8000-000000000000' group by lot_id`,
    )
    expect(plan).toContain("bids_bidder_lot_idx")
  })

  it("o painel do leiloeiro lê os lotes na ordem do índice", async () => {
    const plan = await planWithoutSeqScan(
      `select * from lots where auctioneer_id = '00000000-0000-4000-8000-000000000000'
       order by created_at desc, id limit 20`,
    )
    expect(plan).toContain("lots_auctioneer_created_idx")
    expect(plan).not.toContain("Sort")
  })

  it("a vitrine ordena pelos índices parciais", async () => {
    const plan = await planWithoutSeqScan(
      `select * from lots where cancelled_at is null order by created_at desc, id limit 20`,
    )
    expect(plan).toContain("lots_showcase_created_idx")
  })

  it("os comprovantes de um vencedor usam o índice de winner_id", async () => {
    const plan = await planWithoutSeqScan(
      `select * from receipts where winner_id = '00000000-0000-4000-8000-000000000000'`,
    )
    expect(plan).toContain("receipts_winner_idx")
  })
})
