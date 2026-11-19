# 0004. Limites de tentativas e IP do cliente

## Contexto

Login e cadastro não tinham limite de tentativas, o que permitia adivinhar senhas e gastar CPU com hashes argon2. O app roda atrás do roteador do Heroku, então o IP do cliente vem do cabeçalho `X-Forwarded-For`.

## Decisão

Limites com `@fastify/rate-limit`, guardados em memória:

| Rota                  | Limite                                               |
| --------------------- | ---------------------------------------------------- |
| `POST /auth/login`    | 5 por minuto por IP e e-mail, e 20 por minuto por IP |
| `POST /auth/register` | 5 por minuto por IP                                  |
| `POST /lots/:id/bids` | 30 por minuto por usuário                            |
| todas as rotas        | 300 por minuto por IP                                |
- Os limites de login e cadastro rodam antes do hash da senha.
- A resposta é `429` com o código `RATE_LIMITED` e o cabeçalho `Retry-After`.
- O IP do cliente é o último endereço do `X-Forwarded-For` (`trustProxy` confia em um salto). Com `trustProxy: true` valeria o primeiro, que o cliente pode forjar para ganhar um contador novo.

## Consequências

- O contador fica na memória do processo: reinicia junto com o app e não vale entre várias instâncias. O app já é de instância única (ver "Comportamentos que vale conhecer" no README).
- Pessoas atrás do mesmo IP (uma rede com NAT) dividem o limite.
- A regra de "um salto" supõe que o Heroku é o único proxy na frente. Isso não foi conferido em produção.
- Os testes desligam o limite por padrão (muitas contas pelo mesmo IP); `rate-limit.test.ts` liga.
