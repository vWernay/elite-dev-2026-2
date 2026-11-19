# 0001. Sessões no servidor em vez de JWT

## Contexto

A primeira versão guardava a sessão num JWT dentro de um cookie `httpOnly`. O JWT é válido até expirar: o logout só apagava o cookie no navegador, e quem tivesse copiado o token continuava autenticado por até 7 dias. O papel do usuário também ficava gravado no token.

## Decisão

A sessão passa a viver no servidor, na tabela `sessions`:
- O cookie leva um token aleatório de 32 bytes, sem nenhum dado dentro.
- O banco guarda só o hash SHA-256 do token (`sessions.id`), junto com `user_id`, `expires_at` e `revoked_at`.
- A cada requisição autenticada, o servidor procura a sessão pelo hash, confere que não foi revogada nem venceu e lê o papel do usuário na tabela `users`.
- O logout marca `revoked_at`. Em produção o cookie tem o prefixo `__Host-` (exige `Secure` e `Path=/`).
- O `@fastify/jwt` e a variável `JWT_SECRET` saíram.

Alternativa descartada: manter o JWT e guardar um `token_version` no usuário. É mais simples, mas o logout derrubaria todas as sessões da pessoa de uma vez e continuaria sem registro de cada sessão.

## Consequências

- O logout vale de verdade: o mesmo cookie recebe 401 logo depois.
- Mudar o papel de um usuário vale na próxima requisição.
- Uma consulta a mais por requisição autenticada.
- Um vazamento da tabela `sessions` não entrega sessões válidas, porque só há hashes.
- As sessões vencidas de um usuário são apagadas no login dele. Quem nunca volta deixa linhas vencidas na tabela; não há job de limpeza.
- Não existe "sair de todos os dispositivos" nem troca de senha, então não há como derrubar todas as sessões de uma pessoa pela interface.
