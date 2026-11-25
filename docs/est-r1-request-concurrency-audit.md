# EST-R1.2.2 — concorrência de leituras

Base: f691616c, Quality Gate 45631088040 aprovado.

## Revisão dirigida

- Auth, Discovery, Amizades e Media discovery: reutilizar SessionReadInFlight
  implantado na EST-R1.2.1; não criar uma segunda implementação.
- Comunidades: compartilhar somente páginas de descoberta, comunidades oficiais
  por alvo e listagens públicas por perfil; chave inclui endpoint, filtros,
  limite e cursor. Preview com capacidades, minhas comunidades, membership,
  hidratação de itens após eventos e conteúdo com URLs temporárias permanecem
  independentes: invalidações e revalidações não devem ser suprimidas.
- Media: compartilhar o transporte de metadados da paginação autorizada de
  fotos/vídeos por owner, página e cursor; hidratação e emissão de URLs seguem
  na fronteira própria. Não deduplicar writes, tracking ou reconciliação.
- Chat: descoberta e listeners canônicos já compartilhados; reconciliação,
  mensagens, receipts e invalidation não são leituras intercambiáveis.
- Notificações: janela recente e contador exato representam consultas distintas;
  projeções atuais usam shareReplay com refCount. Não fundir consultas nem
  impedir refresh explícito.
- Amizades/NgRx: leitura simultânea já compartilhada por direção e sessão;
  não unificar inbound/outbound nem remover eventos de atualização.

## Inventário transversal

A CI passa a executar audit-read-request-concurrency.mjs sobre todos os
arquivos TS de produção de src/app. O relatório aponta definições repetidas
de callables, timers, listeners, shareReplay e uso de SessionReadInFlight.
É inventário lexical, não prova de duplicidade em runtime; chamadas indiretas,
fluxos de controle, ownership de listeners e diferenças de payload exigem
revisão. Não elimina apontamentos por allowlist nem bloqueia por contagem.

Testes adicionais cobrem páginas de comunidade e media discovery, igualdade
de payload, distinção por cursor/tipo, revogação e nova leitura após conclusão.
A medição de POSTs reais por sessão, concorrência e regressões de invalidação
permanece pendente de homologação. Nenhuma alteração em Rules, quotas,
backend ou autorização.

## EST-R1.3 — revisão do relatório de 9879083b

Quality Gate 45643578277 e sete workflows visuais aprovados; 3304/3304
Angular e 390/390 testes da outra suíte. Inventário: 882 TS, 174 callables,
9 onSnapshot, 7 docSnapshots, 3 collectionSnapshots, 14 docData,
14 collectionData, 43 timers, 4 intervals, 504 shareReplay e 7
SessionReadInFlight. Duas definições repetidas: deleteDirectMessage e
recordPhotoView. São mutações, com pipelines e finalidades distintos;
não há evidência de POST redundante apenas pela definição. Não coalescer
mutações ou alterar seu contrato de erro. O helper de leitura agora descarta
erros tardios de uma instância Auth substituída mesmo sem mudança de UID.
A aferição de rede em runtime continua pendente de homologação.
