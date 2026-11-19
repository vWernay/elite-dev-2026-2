# 0007. Índices das listagens e busca com pg_trgm

## Contexto

As listagens (vitrine, painel do leiloeiro, "Meus arremates") filtravam e ordenavam sem índice próprio, e a busca com `ILIKE '%texto%'` varria a tabela inteira. Com poucos lotes isso não aparece, mas cresce com o volume.

## Decisão

Uma migration (`0003_indexes_trgm`) cria a extensão `pg_trgm` e estes índices:

| Índice                        | Colunas                                                 | Atende                                 |
| ----------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `bids_bidder_lot_idx`         | `bids (bidder_id, lot_id)`                              | "Meus arremates"                       |
| `lots_auctioneer_created_idx` | `lots (auctioneer_id, created_at desc, id)`             | Painel do leiloeiro e o total recebido |
| `lots_showcase_created_idx`   | `lots (created_at desc, id) where cancelled_at is null` | Vitrine sem filtro e busca             |
| `lots_showcase_ends_idx`      | `lots (ends_at, id) where cancelled_at is null`         | Vitrine "ao vivo" e "encerrados"       |
| `lots_title_trgm_idx`         | GIN `title gin_trgm_ops`                                | Busca por título                       |
| `lots_set_trgm_idx`           | GIN `(attributes->>'set') gin_trgm_ops`                 | Busca por coleção                      |
| `receipts_winner_idx`         | `receipts (winner_id)`                                  | Comprovantes de um vencedor            |

Detalhes que importam:
- Os índices em `created_at` usam `desc` puro (nulls first), igual ao `ORDER BY` das consultas. Com `NULLS LAST`, o planner não usa o índice para ordenar.
- Nenhuma consulta atual lê `receipts` por `winner_id`; o índice cobre a chave estrangeira e o extrato da carteira.
- `lots_pending_settlement_idx` (já existia) atende o worker de liquidação.

## Como foi medido

`pnpm --filter api db:bench` cria o banco `leilao_bench` com 20 mil lotes, cerca de 63 mil lances e 10 mil comprovantes, e imprime o `EXPLAIN (ANALYZE, BUFFERS)` de cada consulta. As consultas do script são cópias das do app: se o app mudar, o script precisa mudar junto. Os dados são sintéticos (os MACs são falsos) e o tempo vem de uma máquina de desenvolvimento, então valem como ordem de grandeza.

Tempo de execução (ms), antes e depois da migration. Os dois bancos foram gerados em execuções separadas, com dados aleatórios do mesmo tamanho:

| Consulta                       | Antes (plano)   | Depois (plano)                                |
| ------------------------------ | --------------- | --------------------------------------------- |
| Vitrine: ao vivo               | 8,0 (Seq Scan)  | 0,2 (Index Scan `lots_showcase_ends_idx`)     |
| Vitrine: encerrados            | 12,3 (Seq Scan) | 0,3 (Index Scan Backward)                     |
| Vitrine: sem filtro            | 21,9 (Seq Scan) | 0,3 (Index Scan `lots_showcase_created_idx`)  |
| Vitrine: busca com termo comum | 27,9 (Seq Scan) | 0,9 (varre o índice de `created_at` e filtra) |
| Vitrine: busca com termo raro  | não medido      | 1,4 (Bitmap Index Scan trigram)               |
| Painel do leiloeiro: lotes     | 8,9 (Seq Scan)  | 0,2 (Index Scan)                              |
| Meus arremates                 | 6,4 (Seq Scan)  | 0,2 (Bitmap Index Scan)                       |
| Comprovantes do vencedor       | 0,9 (Seq Scan)  | 0,1 (Bitmap Index Scan)                       |

## O que continua com Seq Scan

- **Total recebido do leiloeiro:** soma todos os comprovantes dele; o plano ainda varre `receipts` (2,4 ms). É trabalho proporcional ao resultado.
- **Contagem da paginação** (`count(*)` do filtro "ao vivo"): lê todas as linhas que casam (6 ms). Contar é o custo da paginação com `total`; ver ADR 0008.
- **Worker de liquidação:** o planner escolhe Seq Scan (4,6 ms) em vez do índice parcial `lots_pending_settlement_idx`. No banco sintético quase todos os lotes encerrados já estão liquidados, e o planner não sabe disso pelas estatísticas. Não foi confirmado como o plano se comporta em produção.
- **Busca com termo comum:** quando o termo casa com muitas linhas, o planner anda pelo índice de ordenação e filtra, em vez de usar o trigram. É o plano certo para esse caso.

## Consequências

- Cada índice a mais custa espaço e escrita. Os de `lots` entram em toda atualização de lote (cada lance muda `leader_id`, que já tinha índice).
- A migration exige permissão para `CREATE EXTENSION`. O `postgres:17-alpine` do Compose traz o `pg_trgm`.
- O teste `src/db/indexes.test.ts` confere que os índices existem e que as consultas os usam (com o seq scan desligado, porque num banco de teste pequeno o planner prefere varrer a tabela).
