# 0006. Cadeia de auditoria v2, versionada por lote

## Contexto

A cadeia de HMAC cobria os lances, mas não o horário de fim do lote nem o cancelamento e a liquidação. Mudar `ends_at` no banco, ou apagar `cancelled_at` e ressuscitar um lote cancelado, passava sem ser percebido, e o README não dizia isso. Mudar a fórmula invalida as cadeias que já existem, e recalcular os MACs antigos exigiria a chave e confiar no estado atual do banco.

## Decisão

- **v2:** o `genesis` inclui o fim original; cada lance grava `ends_at_after` (o fim que resultou dele) e o inclui no MAC; o `head_mac` inclui `ends_at`, `cancelled_at` e `settled_at`. O cancelamento e a liquidação recalculam o `head_mac` na mesma transação que grava a data.
- **Versionamento:** `lots.chain_version` (padrão do banco: 1). O código escolhe a fórmula pela versão do lote, tanto para verificar quanto para gravar novos lances. Lotes novos recebem 2 explicitamente.
- A auditoria confere também `lots.ends_at` contra o `ends_at_after` do último lance (ou `original_ends_at`).
- Alternativa descartada: rodar a migration e refazer o seed. Funcionaria para dados de demonstração, mas não mostra cuidado com dados existentes.

## Consequências

- Alterar o fim, o fim original, o cancelamento ou a liquidação passa a ser detectado nos lotes v2.
- Os lotes v1 ficam como estavam, com os mesmos limites de antes; a página avisa e o README lista a diferença.
- O código mantém as duas fórmulas. Há um teste que recalcula a v1 por fora do código novo para garantir que ela não mudou.
- O `head_mac` e a impressão digital mudam na liquidação e no cancelamento. O comprovante guarda a ponta já com a liquidação.
- Tirar a v1 do código só será possível quando não houver mais lotes v1.
