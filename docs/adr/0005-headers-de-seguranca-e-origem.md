# 0005. Headers de segurança e checagem de origem

## Contexto

As respostas não tinham CSP, HSTS nem `nosniff`, e nada reforçava o `SameSite=Lax` do cookie contra requisições vindas de outros sites.

## Decisão

- `@fastify/helmet` em todas as respostas. A CSP libera `'self'` e, para imagens, `https://cards.scryfall.io` e `data:`. `connect-src` é só `'self'` (a API e o SSE são da mesma origem). `frame-ancestors 'none'` impede que o site seja embutido em outro.
- `style-src` inclui `'unsafe-inline'`, porque o Mantine injeta estilos em linha. Não há `'unsafe-inline'` em `script-src`.
- A UI do Swagger tem a CSP própria do `@fastify/swagger-ui`, com `'unsafe-inline'` em estilo, porque o bundle dela aplica estilo por script.
- HSTS só em produção (180 dias, com subdomínios). Em `localhost` o navegador não deve fixar HTTPS.
- Requisições que mudam estado (`POST`, `PUT`, `PATCH`, `DELETE`) com um `Origin` diferente do `Host` recebem 403 `FORBIDDEN_ORIGIN`.

## Consequências

- `'unsafe-inline'` em estilo é um enfraquecimento conhecido. Trocá-lo por nonce exigiria o servidor reescrever o `index.html` a cada resposta.
- A checagem de origem só age quando o navegador manda o `Origin`. Requisições sem esse cabeçalho (curl, outros clientes) passam; elas não carregam o cookie de um navegador de outra pessoa.
- A CSP foi conferida abrindo as telas num Chrome sem erros de console; ver o README para o que foi coberto.
