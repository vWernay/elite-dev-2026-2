# 0003. Cadastro sem revelar se o e-mail existe (e o que isso não resolve)

## Contexto

O cadastro respondia "Este e-mail já está cadastrado", o que permitia descobrir quem tem conta. Esconder isso por completo exige verificação por e-mail: o cadastro responderia sempre "enviamos um link" e só o dono da caixa de entrada saberia o resultado. Este projeto não envia e-mail.

## Decisão

- Quando o e-mail já existe, a resposta é a mensagem genérica "Não foi possível concluir o cadastro com esses dados." (400, código `REGISTRATION_FAILED`), sem citar o e-mail.
- O hash da senha roda antes do insert, então o tempo de resposta é parecido nos dois casos.
- O login já respondia igual para e-mail inexistente e senha errada, e verifica um hash falso quando o e-mail não existe.
- O cadastro tem limite de tentativas por IP (ver ADR 0004).

## Consequências

- **A enumeração não acaba.** Um cadastro que dá certo abre a sessão na hora, então quem tenta cadastrar um e-mail livre consegue distinguir "criou" de "recusou". O que existe é atrito: mensagem sem a palavra "cadastrado", tempo parecido e 5 tentativas por minuto por IP.
- A medida de tempo não é um teste de timing: os testes só garantem que o hash roda nos dois casos.
- A solução completa (verificação por e-mail) fica fora do escopo.
