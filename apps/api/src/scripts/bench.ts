// Cria um banco com volume (~50 mil lances) e mostra o plano das consultas das listagens.
// Uso: pnpm --filter api db:bench [--no-reset]
// Os dados são só para medir: os MACs são falsos e as cadeias não conferem.
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

const baseUrl = process.env.DATABASE_URL
if (!baseUrl) throw new Error("DATABASE_URL não definida")

const BENCH_DB = "leilao_bench"
const adminUrl = new URL(baseUrl)
adminUrl.pathname = "/postgres"
const benchUrl = new URL(baseUrl)
benchUrl.pathname = `/${BENCH_DB}`

const reset = !process.argv.includes("--no-reset")

async function createDatabase() {
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  if (reset)
    await admin.query(`drop database if exists ${BENCH_DB} with (force)`)
  const found = await admin.query(
    "select 1 from pg_database where datname = $1",
    [BENCH_DB],
  )
  if (found.rowCount === 0) await admin.query(`create database ${BENCH_DB}`)
  await admin.end()
}

const pool = (url: URL) => new pg.Pool({ connectionString: url.toString() })

async function populate(db: pg.Pool) {
  const { rows } = await db.query("select count(*)::int as n from lots")
  if (rows[0].n > 0) return

  await db.query(`
    insert into users (id, name, email, password_hash, role, balance_cents)
    select gen_random_uuid(), 'Leiloeiro ' || g, 'a' || g || '@bench.test', 'x', 'auctioneer', 0
    from generate_series(1, 20) g;
    insert into users (id, name, email, password_hash, role, balance_cents)
    select gen_random_uuid(), 'Licitante ' || g, 'b' || g || '@bench.test', 'x', 'bidder', 100000000
    from generate_series(1, 2000) g;
  `)

  // 20 mil lotes: 60% encerrados, 20% ao vivo, 10% agendados, 10% cancelados
  await db.query(`
    with a as (select array_agg(id) ids from users where role = 'auctioneer'),
    base as (
      select g, random() as r, now() - (random() * interval '365 days') as created
      from generate_series(1, 20000) g
    )
    insert into lots (id, auctioneer_id, scryfall_id, title, image_url, attributes,
      starting_bid_cents, min_increment_cents, starts_at, ends_at, original_ends_at,
      head_mac, chain_version, created_at, cancelled_at)
    select gen_random_uuid(), a.ids[1 + floor(random() * 20)::int], 'bench-' || g,
      (array['Black Lotus','Lightning Bolt','Counterspell','Serra Angel','Birds of Paradise','Sol Ring','Dark Ritual'])[1 + g % 7] || ' #' || g,
      'https://cards.scryfall.io/x.jpg',
      jsonb_build_object('set', (array['Alpha','Beta','Unlimited','Foundations','Duskmourn','Vintage Masters'])[1 + g % 6]),
      1000, 100,
      case when r < 0.6 then created when r < 0.8 then now() - interval '2 days' when r < 0.9 then now() + interval '3 days' else created end,
      case when r < 0.6 then created + interval '7 days' when r < 0.8 then now() + (random() * interval '10 days') + interval '1 hour' when r < 0.9 then now() + interval '10 days' else created + interval '7 days' end,
      case when r < 0.6 then created + interval '7 days' when r < 0.8 then now() + interval '5 days' when r < 0.9 then now() + interval '10 days' else created + interval '7 days' end,
      'x', 2, created,
      case when r >= 0.9 then created + interval '1 day' end
    from base, a;
  `)

  // lances: de 0 a 8 por lote que já começou (~60 mil no total)
  await db.query(`
    update lots set bid_count = floor(random() * 9)::int
    where starts_at <= now() and cancelled_at is null;
    with bidders as (select array_agg(id) ids from users where role = 'bidder')
    insert into bids (id, lot_id, bidder_id, seq, amount_cents, created_at, ends_at_after, mac)
    select gen_random_uuid(), l.id, b.ids[1 + floor(random() * 2000)::int], s, 1000 + s * 100,
      l.starts_at + s * interval '1 minute', l.ends_at, 'x'
    from lots l, bidders b, lateral generate_series(1, l.bid_count) s;
    update lots l set
      current_bid_cents = 1000 + bid_count * 100,
      leader_id = (select bidder_id from bids where lot_id = l.id and seq = l.bid_count)
    where bid_count > 0;
  `)

  // liquida os lotes encerrados com lances
  await db.query(`
    update lots set settled_at = ends_at where ends_at <= now() and cancelled_at is null;
    insert into receipts (id, lot_id, winner_id, amount_cents, chain_mac, issued_at)
    select gen_random_uuid(), id, leader_id, current_bid_cents, 'x', ends_at
    from lots where settled_at is not null and bid_count > 0;
    analyze;
  `)
}

async function explain(
  db: pg.Pool,
  title: string,
  sql: string,
  params: unknown[] = [],
) {
  const { rows } = await db.query(
    `explain (analyze, buffers, costs off) ${sql}`,
    params,
  )
  console.log(`\n### ${title}`)
  for (const row of rows) console.log(row["QUERY PLAN"])
}

await createDatabase()
const migrationPool = pool(benchUrl)
await migrate(drizzle(migrationPool), { migrationsFolder: "./drizzle" })
await migrationPool.end()

const db = pool(benchUrl)
try {
  await populate(db)
  const counts = await db.query(
    `select (select count(*) from lots)::int lots, (select count(*) from bids)::int bids,
            (select count(*) from receipts)::int receipts, (select count(*) from users)::int users`,
  )
  console.log("volume:", counts.rows[0])

  // Um licitante com muitos lances e um leiloeiro com muitos lotes
  const [{ bidder }] = (
    await db.query(
      `select bidder_id bidder from bids group by bidder_id order by count(*) desc limit 1`,
    )
  ).rows
  const [{ auctioneer }] = (
    await db.query(
      `select auctioneer_id auctioneer from lots group by auctioneer_id order by count(*) desc limit 1`,
    )
  ).rows

  // Cópias das consultas do app (lots/service.ts, bidder/routes.ts, wallet/balance.ts)
  await explain(
    db,
    "Vitrine: lotes ao vivo",
    `select * from lots where cancelled_at is null and starts_at <= now() and ends_at > now()
     order by ends_at, id limit 20 offset 0`,
  )
  await explain(
    db,
    "Vitrine: lotes encerrados",
    `select * from lots where cancelled_at is null and ends_at <= now()
     order by ends_at desc, id limit 20 offset 0`,
  )
  await explain(
    db,
    "Vitrine: sem filtro",
    `select * from lots where cancelled_at is null order by created_at desc, id limit 20 offset 0`,
  )
  await explain(
    db,
    "Vitrine: busca por texto",
    `select * from lots where cancelled_at is null
       and (title ilike $1 or attributes->>'set' ilike $1)
     order by created_at desc, id limit 20`,
    ["%lotus%"],
  )
  await explain(
    db,
    "Vitrine: busca por texto raro (usa o índice trigram)",
    `select * from lots where cancelled_at is null
       and (title ilike $1 or attributes->>'set' ilike $1)
     order by created_at desc, id limit 20`,
    ["%Sol Ring #1999%"],
  )
  await explain(
    db,
    "Vitrine: total de lotes ao vivo (count da paginação)",
    `select count(*) from lots where cancelled_at is null and starts_at <= now() and ends_at > now()`,
  )
  await explain(
    db,
    "Painel do leiloeiro: lotes do leiloeiro",
    `select l.*, r.* from lots l left join receipts r on r.lot_id = l.id
     where l.auctioneer_id = $1 order by l.created_at desc, l.id limit 20`,
    [auctioneer],
  )
  await explain(
    db,
    "Painel do leiloeiro: total recebido",
    `select coalesce(sum(r.amount_cents), 0) from receipts r
     join lots l on l.id = r.lot_id where l.auctioneer_id = $1`,
    [auctioneer],
  )
  await explain(
    db,
    "Meus arremates: lotes em que dei lance",
    `select lot_id, max(amount_cents) from bids where bidder_id = $1 group by lot_id`,
    [bidder],
  )
  await explain(
    db,
    "Carteira: valor comprometido",
    `select coalesce(sum(current_bid_cents), 0) from lots
     where leader_id = $1 and settled_at is null and cancelled_at is null`,
    [bidder],
  )
  await explain(
    db,
    "Comprovantes do vencedor",
    `select * from receipts where winner_id = $1 order by issued_at desc limit 20`,
    [bidder],
  )
  await explain(
    db,
    "Worker: lotes para liquidar",
    `select id from lots where ends_at <= now() and settled_at is null and cancelled_at is null
     order by ends_at`,
  )
} finally {
  await db.end()
}
