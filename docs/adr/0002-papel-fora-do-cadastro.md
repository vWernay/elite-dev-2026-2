# 0002. O papel não vem do corpo do cadastro

## Contexto

`POST /api/auth/register` aceitava `role` no corpo. Qualquer pessoa podia mandar `"auctioneer"` e criar lotes, e a tela de cadastro tinha um seletor para isso.

## Decisão

- O cadastro público sempre cria um licitante. Um `role` enviado no corpo é ignorado.
- Leiloeiros são criados fora da API pública, pelo script `user:create` (e pelo seed, no caso das contas de demonstração).
- O papel usado nas rotas vem sempre da tabela `users`, nunca da requisição.

## Consequências

- Não há como virar leiloeiro pela API pública.
- Criar um leiloeiro exige acesso ao ambiente (terminal com o `DATABASE_URL`). Não existe tela de administração.
- Não há um papel de administrador: quem tem acesso ao banco ou ao script é, na prática, o administrador.
