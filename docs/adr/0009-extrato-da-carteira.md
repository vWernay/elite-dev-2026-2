# 0009. Extrato da carteira (ledger) só de inserção

## Contexto

O saldo de cada usuário era um único número (`users.balance_cents`), alterado por depósitos e pela liquidação. Não havia como ver de onde o saldo veio, nem como conferir que ele estava certo.

## Decisão

- Tabela `wallet_entries`, com uma linha por movimento: `kind` (`opening`, `deposit`, `lot_debit`, `lot_credit`, `adjustment`), `amount_cents` com sinal, `balance_after_cents` (o saldo logo depois do movimento) e `lot_id` quando há lote.
- Cada linha é gravada **na mesma transação** que muda `users.balance_cents`: no depósito e na liquidação (débito do vencedor e crédito do leiloeiro). O saldo novo vem do `RETURNING` do `UPDATE`, que já tem o lock da linha do usuário.
- A tabela é só de inserção: um trigger recusa `UPDATE` e `DELETE`. Constraints recusam valor zero, saldo negativo e sinal errado para o tipo (por exemplo, `lot_debit` positivo).
- A migration cria uma linha `opening` para cada saldo que já existia, para a soma do extrato bater com o saldo. O seed, que redefine os saldos de demonstração, grava a diferença como `adjustment`.
- `lot_id` não tem chave estrangeira, para o extrato sobreviver à remoção de um lote (só o seed remove lotes).
- A invariante (saldo = soma do extrato = `balance_after_cents` da última linha) é conferida por `verifyLedger()` e pelo script `pnpm --filter api ledger:check`. Os testes rodam depósitos e liquidações simultâneos e conferem a invariante depois.
- `GET /api/wallet/entries` (paginado) serve o extrato do próprio usuário: o licitante vê depósitos e arremates; o leiloeiro vê as vendas.

## Consequências

- **A invariante não é imposta pelo banco.** Quem altera `users.balance_cents` direto no banco, sem passar pelo código, desfaz a igualdade; a conferência detecta, mas não impede. O trigger protege as linhas do extrato, não o saldo.
- Quem tem acesso de superusuário pode desabilitar o trigger. O extrato não é assinado (diferente da cadeia de lances, ADR 0006).
- Todo código novo que mexer em saldo precisa gravar a linha. Hoje são três pontos: depósito, liquidação e seed.
- Os testes que definem saldo direto na tabela (atalho para montar cenários) deixam o extrato desses usuários sem linhas; só os testes do extrato usam o depósito de verdade.
- O extrato cresce sem limite; a listagem é paginada e indexada por `(user_id, id desc)`.
