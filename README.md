# Mesa de Lances

Casa de leilões online de cartas de Magic: The Gathering, feita para o teste técnico Elite Dev da Verzel.

O leiloeiro busca cartas na API pública do [Scryfall](https://scryfall.com/docs/api) e monta lotes com elas. Os licitantes depositam um saldo simulado e disputam os lotes com lances ao vivo. Quem vence recebe um comprovante com link para compartilhar. Qualquer pessoa, mesmo sem login, consegue auditar o histórico de lances de um lote e ver se ele foi adulterado.

- **Deploy:** https://leilao-verzel-418ab1d62f19.herokuapp.com/
- **Documentação da API (Swagger):** https://leilao-verzel-418ab1d62f19.herokuapp.com/api/docs

## Contas de demonstração

O seed cria estas contas, todas com a senha `senha12345`:

| Papel | E-mail | Saldo inicial |
| --- | --- | --- |
| Leiloeiro | `leiloeiro@demo.com` | R$ 0,00 |
| Licitante | `ana@demo.com` | R$ 10.000,00 |
| Licitante | `bruno@demo.com` | R$ 10.000,00 |

E estes lotes:

| Lote | Situação |
| --- | --- |
| Black Lotus | Ao vivo, com 5 lances entre Ana e Bruno. Termina 30 dias depois do seed |
| Lightning Bolt | Ao vivo, com 3 lances. Termina 25 minutos depois do seed, para ver a contagem regressiva e o anti-sniping |
| Birds of Paradise | Ao vivo, sem lances |
| Counterspell | Agendado: começa 14 dias depois do seed |
| Serra Angel | Encerrado e arrematado pela Ana, com comprovante |

Para ver o tempo real, abra a sala do mesmo lote em dois navegadores (ou uma janela anônima), um logado como Ana e outro como Bruno, e dê lances alternados.

## Funcionalidades

| Tela | Rota |
| --- | --- |
| Vitrine de lotes, separada em ao vivo, agendados e encerrados, com busca por título ou coleção | `/` |
| Sala do lote ao vivo | `/lotes/:id` |
| Página de auditoria (pública) | `/lotes/:id/auditoria` |
| Painel do leiloeiro | `/painel` |
| Carteira do licitante | `/carteira` |
| Meus arremates | `/arremates` |
| Comprovante de arremate (público) | `/comprovante/:id` |
| Entrar e cadastro | `/entrar`, `/cadastro` |

Os opcionais feitos: busca e filtro de lotes, cancelamento de lote com estorno automático, Docker Compose, testes automatizados e dark mode.

## Stack

- **Monorepo:** pnpm workspaces, com `apps/api` e `apps/web`.
- **API:** Node.js, TypeScript, Fastify, Zod (`fastify-type-provider-zod`), Drizzle ORM, PostgreSQL, Swagger.
- **Web:** React, TypeScript, Vite, TanStack Router, TanStack Query, Mantine. O cliente da API é gerado pelo Orval a partir do OpenAPI.
- **Tempo real:** Server-Sent Events (SSE).
- **Testes:** Vitest, rodando contra um Postgres real.
- **Lint e formatação:** Biome.

Em produção, a API também serve o build do front. Front e API ficam na mesma origem, então não há CORS, e a sessão é um cookie `httpOnly`.

## Como rodar localmente

### Pré-requisitos

- Node.js 22 ou mais recente.
- pnpm 12. Com o Corepack: `corepack enable`.
- Docker, para o Postgres.

### Passo a passo

```bash
# 1. Dependências
pnpm install

# 2. Variáveis de ambiente
cp .env.example .env
# Preencha AUDIT_SECRET e JWT_SECRET com valores diferentes. Dica: para gerar cada um:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Banco de dados
docker compose up -d

# 4. Migrations e dados de demonstração
pnpm --filter api db:migrate
pnpm --filter api seed

# 5. API (porta 3000) e front (porta 5173), cada um num terminal
pnpm dev:api
pnpm dev:web
```

Abra http://localhost:5173. Em desenvolvimento, o Vite encaminha `/api` para a API. O Swagger fica em http://localhost:3000/api/docs.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | sim | URL de conexão do Postgres |
| `AUDIT_SECRET` | sim | Chave da cadeia de HMAC (mínimo de 32 caracteres). Nunca é gravada no banco |
| `JWT_SECRET` | sim | Chave de assinatura da sessão (mínimo de 32 caracteres) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | só local | Usadas pelo Docker Compose |
| `PORT` | não | Porta da API. Padrão: `3000` |
| `NODE_ENV` | não | `development`, `production` ou `test`. Em `production`, o cookie de sessão passa a ser `Secure` |
| `DATABASE_SSL` | não | `true` ou `false`. Padrão: ligado só em produção |
| `WEB_DIST_DIR` | não | Pasta do build do front que a API serve. Definida na imagem Docker |
| `TEST_DATABASE_URL` | não | Banco dos testes. Padrão: `leilao_test` no Postgres local |

### Outros comandos

```bash
pnpm test                       # testes da API
pnpm lint                       # Biome
pnpm build                      # build da API e do front
pnpm --filter api seed          # recria os dados de demonstração

# Depois de mudar uma rota da API, para atualizar o cliente do front:
pnpm --filter api openapi:export
pnpm --filter web api:generate
```

Os testes precisam do Postgres do Docker Compose rodando. O banco `leilao_test` é criado e migrado automaticamente na primeira execução.

O seed pode ser rodado de novo quantas vezes quiser. Ele recria as três contas demo e os cinco lotes, que têm ids fixos, e não mexe em outros dados.

## Deploy

O app roda no Heroku com a stack `container`:
- **Imagem:** o `Dockerfile` gera uma imagem com a API e o build do front.
- **Migrations:** o `heroku.yml` roda as migrations na fase de release.
- **Dyno:** um dyno Basic, que não hiberna. O stream SSE e o worker de liquidação precisam do processo sempre ativo.
- **Banco:** Heroku Postgres.

```bash
git push heroku main                                 # publicar
heroku run "node dist/seed.js" -a leilao-verzel      # dados de demonstração
```

## Como funciona

### Regras de lance

Um lance só é aceito se todas estas condições forem verdadeiras:

1. Quem dá o lance é licitante. Leiloeiros não dão lance.
2. O lote está ao vivo: começou e ainda não terminou.
3. O licitante não é quem já lidera o lote.
4. O valor é suficiente:
   - o primeiro lance precisa ser maior ou igual ao lance inicial;
   - os seguintes precisam ser maiores ou iguais ao lance atual mais o incremento mínimo.
5. O valor cabe no saldo disponível.

Cada recusa tem um código próprio, e o front mostra uma mensagem com o motivo:

| Código | Mensagem |
| --- | --- |
| `BID_BELOW_MINIMUM` | O lance mínimo agora é R$ X. |
| `INSUFFICIENT_FUNDS` | Saldo insuficiente. Disponível: R$ X. |
| `ALREADY_WINNING` | Você já está ganhando este lote. |
| `LOT_NOT_STARTED` | Este lote ainda não começou. |
| `LOT_ENDED` | Este lote já foi encerrado. |
| `LOT_CANCELLED` | Este lote foi cancelado. |

### Saldo comprometido

O saldo comprometido não é guardado numa coluna. Ele é a soma dos lances atuais dos lotes que o licitante lidera e que ainda não foram liquidados nem cancelados.

- Quando alguém supera o lance, o líder do lote muda e o valor volta ao disponível de quem foi superado na mesma transação. Nenhum saldo precisa ser movimentado.
- O mesmo vale para o cancelamento: cancelar o lote libera o valor reservado na hora. É assim que funciona o estorno automático.

### Concorrência

O lance roda numa transação com `SELECT ... FOR UPDATE`: primeiro trava o lote, depois o licitante. O horário e o saldo comprometido são lidos depois dos locks. Assim:
- dois lances simultâneos no mesmo lote acontecem em fila;
- um licitante dando lances em dois lotes ao mesmo tempo não consegue comprometer mais do que tem.

O banco ainda tem três redes de segurança:
- `CHECK (balance_cents >= 0)`;
- `UNIQUE (lot_id, seq)` nos lances;
- `UNIQUE (lot_id)` nos comprovantes, que impede liquidar o mesmo lote duas vezes.

### Prorrogação (anti-sniping)

Um lance aceito nos últimos 2 minutos muda o fim do lote para **2 minutos depois do lance**. A sala mostra que o lote foi prorrogado.

### Liquidação

Um worker roda a cada 2 segundos dentro do próprio processo da API e procura lotes que já terminaram e ainda não foram liquidados.

- **Lote com lances:** o worker verifica a cadeia de lances, debita o valor do vencedor, credita o leiloeiro e gera o comprovante.
- **Lote sem lances:** fecha sem vencedor.

### Gestão da API externa

O Scryfall só é chamado em dois momentos: na busca de cartas do painel do leiloeiro e na criação de um lote.

- **Cópia do item:** ao criar o lote, a API grava uma cópia da carta no banco (título, imagem e atributos). Vitrine, sala, auditoria e comprovante leem só do banco e continuam funcionando com o Scryfall fora do ar.
- **Cliente do Scryfall:**
  - timeout de 5 s;
  - um intervalo mínimo entre chamadas, para respeitar o limite de requisições;
  - cache em memória de 10 minutos;
  - se a chamada falhar, devolve o cache vencido quando houver.
- **Sem cache:** a busca responde `EXTERNAL_API_UNAVAILABLE`, e o painel mostra "A busca de cartas está indisponível no momento" com um botão para tentar de novo.

### Tempo real

A sala do lote assina um stream SSE em `/api/lots/:id/events`, com os eventos `bid`, `settled` e `cancelled`. O lance em si vai por um `POST` normal.

- **Atualização da tela:** o front aplica cada evento direto no cache do TanStack Query, sem recarregar a página.
- **Heartbeat:** a cada 20 s, para o proxy não fechar a conexão.
- **Reconexão:** a cada reconexão, o front busca o lote de novo para recuperar o que perdeu.

### Histórico à prova de adulteração

Os lances de cada lote formam uma **cadeia de HMAC-SHA256**. A chave (`AUDIT_SECRET`) fica numa variável de ambiente do servidor e nunca vai para o banco. Quem tem acesso ao banco consegue mudar os dados, mas não consegue gerar MACs válidos.

```
genesis  = HMAC(K, ["genesis", lot_id, lance_inicial, incremento, inicio])
mac_n    = HMAC(K, ["bid", lot_id, seq, licitante, valor, data, mac_(n-1) ou genesis])
head_mac = HMAC(K, ["head", lot_id, quantidade_de_lances, ultimo_mac])
```

- **`genesis`** é o elo inicial. Não é gravado: é recalculado sempre que preciso. Por incluir as regras do lote, mudar o lance inicial ou o incremento depois dos lances também quebra a cadeia.
- **`mac_n`** é gravado em cada lance e encadeia o lance no anterior.
- **`head_mac`** é gravado no lote e marca a ponta da cadeia. Sem ele, apagar o último lance passaria despercebido, porque nada depois dele quebraria.

Toda entrada do HMAC é um array serializado com `JSON.stringify`, com ordem fixa, valores em centavos como string e datas em ISO UTC. A data do lance é gerada pela aplicação e gravada exatamente como entrou no MAC. Se ela viesse do `now()` do banco, que guarda microssegundos, o valor lido de volta seria diferente do usado no cálculo.

| Adulteração no banco | Resultado na auditoria |
| --- | --- |
| Alterar valor, licitante ou data de um lance | Adulterado no lance #N |
| Editar o MAC de um lance | Adulterado no lance #N |
| Inserir um lance falso | Adulterado no lance #N |
| Remover um lance do meio | Adulterado |
| Trocar a ordem de dois lances | Adulterado no lance #N |
| Remover o último lance | Lances removidos do final |
| Alterar o lance atual ou o líder do lote | Adulterado |
| Alterar o lance inicial ou o incremento | Adulterado desde o lance #1 |

A página de auditoria mostra cada lance com sua situação, o veredito geral e uma **impressão digital** da cadeia: os 16 primeiros caracteres do `head_mac`. A mesma impressão digital aparece no comprovante. Quem guardou o comprovante tem um registro, fora do banco, de como a cadeia estava no fechamento.

Um lote com a cadeia adulterada **não é liquidado**: o worker registra um aviso no log e deixa o lote pendente.

#### Testando a detecção

Com o seed rodado, abra o banco local:

```bash
docker compose exec db psql -U leilao -d leilao
```

Rode um dos comandos abaixo e abra a auditoria do Black Lotus (`/lotes/5eed0000-0000-4000-8000-000000000001/auditoria`). Depois de cada teste, rode `pnpm --filter api seed` para voltar ao estado original.

```sql
-- Alterar o valor de um lance -> "Adulterado no lance #1"
UPDATE bids SET amount_cents = amount_cents + 100
WHERE lot_id = '5eed0000-0000-4000-8000-000000000001' AND seq = 1;

-- Apagar o último lance -> "Lances removidos do final"
DELETE FROM bids
WHERE lot_id = '5eed0000-0000-4000-8000-000000000001' AND seq = 5;

-- Inserir um lance falso -> "Adulterado no lance #6"
INSERT INTO bids (lot_id, bidder_id, seq, amount_cents, created_at, mac)
SELECT lot_id, bidder_id, 6, amount_cents + 1000, now(), repeat('0', 64)
FROM bids WHERE lot_id = '5eed0000-0000-4000-8000-000000000001' AND seq = 5;

-- Trocar a ordem de dois lances -> "Adulterado no lance #1"
UPDATE bids SET seq = 99 WHERE lot_id = '5eed0000-0000-4000-8000-000000000001' AND seq = 1;
UPDATE bids SET seq = 1  WHERE lot_id = '5eed0000-0000-4000-8000-000000000001' AND seq = 2;
UPDATE bids SET seq = 2  WHERE lot_id = '5eed0000-0000-4000-8000-000000000001' AND seq = 99;
```

Os mesmos cenários estão cobertos nos testes automatizados da auditoria.

#### Limitações

- **Restauração de uma cópia antiga:** quem guardou uma cópia antiga *completa* do lote e dos lances pode restaurá-la, e a cadeia continua válida. A impressão digital no comprovante ajuda a contestar, mas não impede.
- **Vazamento da chave:** se o `AUDIT_SECRET` vazar, a proteção acaba. Não há rotação de chave.
- **Quem verifica é o servidor:** a chave é secreta, então a verificação é feita pelo servidor e a página pública mostra o resultado. Isso protege contra adulteração direta no banco, não contra um servidor malicioso. Para que terceiros pudessem verificar sozinhos, seria preciso trocar o HMAC por assinatura digital (Ed25519). Achei que isso ia além do que o desafio pede.

### Privacidade

A auditoria, o comprovante e o stream SSE nunca mostram nome ou e-mail. Cada licitante aparece como um pseudônimo, por exemplo **Licitante #a3f9c1**. Os 6 caracteres são os primeiros de `HMAC(K, ["pseudonym", lot_id, user_id])`.

- O pseudônimo muda de um lote para outro, então não dá para cruzar a atividade de alguém entre lotes.
- Quando o usuário está logado, a API informa qual é o pseudônimo dele naquele lote. É com isso que a sala mostra "você está ganhando" ou "você foi superado".

## Comportamentos que vale conhecer

- **Comprovante e saldo após o fim do lote:** o lote aparece como encerrado no segundo exato em que termina, mas o comprovante e a movimentação de saldo aparecem até uns 2 segundos depois, no próximo ciclo do worker.
- **Cancelamento até o fim:** o leiloeiro pode cancelar um lote ao vivo com lances até o último segundo. O histórico continua disponível na auditoria.
- **Seed redefine os saldos:** rodar o seed de novo volta o saldo das contas demo para R$ 10.000,00. Se uma conta demo estiver liderando um lote criado fora do seed com valor maior que isso, a liquidação desse lote falha pela regra de saldo não negativo.
- **Imagens:** a cópia do item guarda a URL da imagem, não o arquivo. As imagens ficam na CDN do Scryfall (`cards.scryfall.io`), que é separada da API, mas se essa CDN cair as imagens não carregam.
- **Uma instância só:** os eventos SSE são distribuídos em memória e o worker roda dentro do processo. O app foi feito para uma única instância. Para escalar horizontalmente, seria preciso trocar a distribuição de eventos (por exemplo, por `LISTEN/NOTIFY` do Postgres).
- **Recarga periódica:** a sala também busca o lote de novo a cada 20 s, como garantia para quando a conexão SSE cair sem avisar. A vitrine, o painel e "Meus arremates" atualizam a cada 15 s.
- **Rota `/estilo`:** é o guia visual do tema, usado durante o desenvolvimento. Só existe em modo de desenvolvimento; em produção, redireciona para a vitrine.

## Estrutura

```
apps/
  api/
    drizzle/         migrations
    src/
      audit/         cadeia de HMAC e rota de auditoria
      auth/          cadastro, login, sessão e guard de papel
      bids/          regras e transação do lance
      cards/         cliente do Scryfall e busca de cartas
      events/        stream SSE
      lots/          lotes, vitrine e painel do leiloeiro
      receipts/      comprovante
      settlement/    liquidação e worker
      wallet/        carteira e depósito
      seed.ts        dados de demonstração
  web/
    src/
      api/generated/ cliente gerado pelo Orval
      components/
      routes/        rotas do TanStack Router (uma por arquivo)
      theme.ts       tema do Mantine
```
