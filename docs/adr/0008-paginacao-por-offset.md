# 0008. Paginação por limit e offset nas listagens

## Contexto

A vitrine já paginava, mas o painel do leiloeiro e "Meus arremates" devolviam todos os lotes de uma vez. Além disso, os totais do painel ("em andamento", "arrematados") e o filtro de "Meus arremates" eram calculados no navegador sobre a lista completa, o que deixa de funcionar quando a lista vem em páginas.

## Decisão

- `GET /api/auctioneer/lots` e `GET /api/bidder/lots` aceitam `limit` (1 a 100, padrão 20) e `offset` (padrão 0), como `GET /api/lots`.
- A resposta traz `total` (de todos os itens que casam com o filtro) e `counts`. O total recebido e as contagens são calculados no banco sobre **todos** os lotes do usuário, nunca só sobre a página.
- O filtro de "Meus arremates" (`filter=all|ongoing|won|lost`) passou para o servidor, e `counts` traz o número de cada filtro (mostrado nas abas).
- A ordem é estável: `created_at desc, id` no painel e `ends_at desc, id` em "Meus arremates".
- Os índices que sustentam essas consultas estão no ADR 0007.
- Páginas de 10 itens no front; a API aceita até 100.
- No banco do `db:bench` (ADR 0007), a página e as contagens de "Meus arremates" de um licitante com 53 lances usam `bids_bidder_lot_idx` e a chave primária de `lots`, em cerca de 1 a 2 ms cada.

## Consequências

- **Offset tem custo crescente.** Páginas fundas leem e descartam as linhas anteriores. Para o volume esperado de um leiloeiro ou licitante isso não pesa; uma paginação por cursor (`created_at, id`) seria o próximo passo se pesasse.
- **Pode repetir ou pular itens** se a lista mudar entre duas páginas (um lote novo empurra os outros para baixo). A tela recarrega a cada 15 s.
- **Cada página faz mais de uma consulta** (a página, as contagens e, em "Meus arremates", o maior lance dos itens da página).
- Um `limit` acima de 100 é recusado (400), então ninguém baixa tudo de uma vez por essas rotas.
