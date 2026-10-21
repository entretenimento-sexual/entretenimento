# c18x-B3 — Exclusão de conta × processamento/recuperação de vídeo

## Problema demonstrado na auditoria de código

O lifecycle da conta define `users/{uid}.accountStatus` como
`pending_deletion` no pedido e `deleted` durante o purge;
`deleted_accounts_audit/{uid}` sobrevive à exclusão do usuário.
As transações de confirmação terminal e recuperação administrativa
anteriormente não verificavam essa autoridade e podiam receber resultados
atrasados enquanto a conta estava em exclusão.

## Correção aplicada

Um predicado de account_lifecycle lê o estado do dono **dentro da
transação do writer**; para usuário raiz ausente, lê pontualmente
`deleted_accounts_audit/{uid}`. Se o usuário está em
`pending_deletion`/`deleted` ou existe tombstone, bloqueia
retries/rechecks administrativos e transforma uma confirmação terminal
ainda válida em CANCEL_REQUESTED, com evento no mesmo commit, sem
recriar vídeo ou publicação. A identidade da conta continua a autoridade;
Media não implementa segunda política de maioridade.

A verificação tem custo de 1 leitura pontual transacional por commit
e uma segunda somente quando o documento de usuário não existe.
Não foram criados novos schedulers, index, scan, triggers ou consultas
ao Transcoder. Comandos obsoletos continuam sujeitos ao version fencing
existente. O comportamento de ausência simultânea da conta e tombstone
legado não é prova de exclusão; o contrato de purge deve preservar audit.

## Evidência em Emulator

- Resultado terminal após status pending_deletion vira CANCEL_REQUESTED,
  sem patch de vídeo ou evento de sucesso.
- Writer real do domínio de exclusão de conta disputa com terminal:
  estado final cancelado, apenas um evento de transição.
- Retry e reconferências administrativas recusados para contas em
  exclusão, sem eventos órfãos.
- Após purge, tombstone impede confirmação atrasada mesmo sem users/{uid}.
- Mudança de lifecycle disputa transação terminal: sucesso só pode
  ocorrer antes de o status mudar; o ledger segue os commits efetivos.

## Limites e próximas etapas

O Emulator valida esses cenários, não exaustividade de todas as
publicações, callbacks externos, migrações e autores fora do inventário.
Resultados terminais que confirmaram **antes** do pedido de exclusão
serão posteriormente tratados pelo domínio de limpeza de conta e a
exposição pública já é bloqueada pelo lifecycle canônico.
Cobertura global, custos reais e ordenação global permanecem sem prova.

c18x-B4 = reconciliação determinística em sessões fechadas;
c18x-B5 = auditoria de fechamento. c19 e deploy permanecem bloqueados.

globalCoverageVerified=false; globallySequenced=false;
productionCostVerified=false; cleanupAuthorized=false.
