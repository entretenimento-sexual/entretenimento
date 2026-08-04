# Runtime local isolado

## Objetivo

O desenvolvimento executado em `localhost` não deve acessar silenciosamente o projeto Firebase cloud `entretenimento-sexual`.

Esse isolamento evita:

- chamadas para Functions ainda não implantadas;
- falhas CORS interpretadas como falhas de domínio;
- alterações acidentais em Auth, Firestore ou Storage cloud;
- dependência de deploy para testar uma branch em desenvolvimento;
- repetição falsa de etapas como aceite de termos, consentimento adulto ou recuperação de conta.

## Comando recomendado no Windows

```powershell
npm run dev:auth:win
```

O launcher existente:

1. verifica as portas antes de iniciar;
2. recupera apenas processos locais reconhecidos;
3. inicia Auth, Firestore, Storage, Functions e demais emuladores necessários;
4. preserva os dados em `.emulator-data`;
5. inicia o Angular com a configuração `dev-emu`;
6. aguarda os serviços ficarem disponíveis antes de abrir o navegador.

## Ambiente local padrão

O `angular.json` aplica o replacement:

```text
development → environment.dev-emu.ts
```

Por isso, os comandos abaixo usam os emuladores:

```powershell
npm start
npm run start:dev
ng serve
```

`environment.ts` permanece como configuração-base de compilação e testes. Ele não é usado diretamente pelo servidor local porque a configuração `development` o substitui antes do build servido.

## Ambiente cloud explícito

A configuração `dev-cloud` usa `environment.dev-cloud.ts` e precisa ser selecionada conscientemente:

```powershell
ng serve -c dev-cloud
```

Ela não implanta Functions, Rules, índices ou qualquer outro recurso.

Não use `dev-cloud` para testar código cujo backend ainda não foi implantado. A ausência de uma callable na cloud pode aparecer no navegador como CORS porque a requisição termina antes de produzir uma resposta callable válida.

## Termos e consentimentos

O desenvolvimento local não ignora os requisitos jurídicos.

- aceite e consentimentos continuam fail-closed;
- o registro é feito pelas callables emuladas;
- o navegador não grava aceite diretamente no Firestore;
- a persistência local é mantida pelo export dos emuladores;
- uma falha de infraestrutura não é reinterpretada como aceite válido.

Se o usuário local ainda não aceitou a versão vigente, a tela será exibida uma vez e o aceite será persistido no ambiente emulado.

## Produção e staging

Nada neste fluxo altera os environments de produção ou staging. Ambos continuam usando file replacements próprios no `angular.json`.

Nenhum deploy é executado por esses comandos.
