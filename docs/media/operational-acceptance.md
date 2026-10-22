# Módulo Media — Aceitação operacional e liberação

Esta matriz complementa os testes automatizados. **Não equivale a autorização de deploy ou certificação automática.** Execute somente em ambiente isolado ou homologação autorizada, com contas fictícias, dados sintéticos e sem mídia de pessoas reais.

## Identificação do aceite

Registrar em cada execução: commit da `main` (SHA completo), data/hora e fuso, ambiente, operador, cenário, resultado (APROVADO/FALHOU/BLOQUEADO), evidência técnica (run/job, log sanitizado, vídeo de teste), defeito e decisão. Não registrar URLs assinadas, tokens, dados pessoais ou evidências probatórias nos anexos.

## Gates inegociáveis

| Gate | Evidência exigida | Critério para aceitar |
| --- | --- | --- |
| G1 — Código | Quality Gate canônico no HEAD candidato | Sucesso |
| G2 — Jornadas E2E | Fotografias e vídeos no mesmo SHA | Ambos aprovados |
| G3 — Concorrência | Reconciliação transacional isolada | Aprovada |
| G4 — Storage real | `verify-media-gcs-live-preconditions.mjs` em bucket não produtivo isolado | `status: passed`, `posterCopyRejectedOverwrite: true`, `fixtureDeleted: true` |
| G5 — Retenção e integridade | Evidências de moderação, exclusões com generation e jobs legados | Não há exclusão sem geração nem quebra de retenção |
| G6 — UX e permissões | Matriz de perfis abaixo | Sem exposição indevida e feedback claro |
| G7 — Operação | Observabilidade, dead letters, limites, suporte e rollback | Plano e responsáveis definidos |

**No-Go:** qualquer gate pendente ou falho. Registrar a decisão e não iniciar liberação produtiva por inferência.

## Matriz de jornadas críticas (executar manualmente)

| ID | Perspectiva/jornada | Critério de aceite |
| --- | --- | --- |
| A01 | Proprietário: upload de foto e vídeo | Validação de formato, cotas, cancelamento, progresso reativo, erro recuperável e decisão explícita de audiência |
| A02 | Proprietário: publicação, edição, republicação e remoção | A publicação usa versão física nova; estado de moderação e audiência permanecem canônicos |
| A03 | Perfil vinculado autorizado | Exibe somente mídia permitida, com atualização após mudança de audiência |
| A04 | Perfil não vinculado | Não consegue obter URL, metadados sensíveis ou acesso via deep link quando restrito |
| A05 | Público não autenticado | Não acessa mídia privada, quarentenada, suspensa ou de titular bloqueado |
| A06 | Bloqueio bilateral | Revoga acesso por URL assinada recém-solicitada, exploração, perfil, links e interações |
| A07 | Quarentena/moderação | Bloqueia exposição, sessões de reprodução, visualizações, retenção e distribuição enquanto não aprovada |
| A08 | Evidência preservada e decisão REMOVE | Obrigação persistida antes da exclusão; falha resulta em recuperação, sem apagar a evidência retida |
| A09 | Exclusão simultânea e retry | HTTP 412 não produz exclusão sem pré-condição; job permanece rastreável para revisão |
| A10 | Job histórico sem generation | Não identifica a geração atual como a antiga; entra em revisão manual sem apagar substituição |
| A11 | Conta em exclusão | Resultados atrasados e eventos não republicam mídias do titular |
| A12 | Reprodução e descoberta | URL temporária, audience, owner, age e publication verificados no backend e projeções |
| A13 | Segurança e privacidade | App Check, rate limiting, rules, acesso por role e idade em todas as entradas |
| A14 | UX de erro | Feedback claro e acessível; modais onde apropriado, sem erros engolidos; centralização de `global-error-handler.service.ts` e `error-notification.service.ts` no cliente |
| A15 | Resiliência | Retry idempotente, deduplicação, dead letter sem expiração destrutiva, logs/alertas e observabilidade |
| A16 | Monetização | Cobrança validada no backend, sem carteira/transferência; vídeo patrocinado permanece desabilitado |
| A17 | UI/reatividade | Desktop/mobile, teclado/leitor de tela, grids, preload/cancelamento, estados vazios e atualização sem recarga |
| A18 | Revogação | Despublicar/bloquear/alterar audiência invalida acesso novo e não vaza URL em snapshot/cache |
| A19 | Operação e custos | Limites de armazenamento/processamento, índices, métricas, alertas de erro e política de retenção revisados |

Executar A01–A19 com usuários de teste distintos. Registre falhas reproduzíveis antes de considerar aceito. Se a mídia exigir preservação legal, a execução deve ser totalmente simulada: nunca usar caso ou arquivo real.

## Sequência de liberação (não executada por este documento)

1. Congelar um SHA candidato na `main` e anexar os quatro resultados de CI correspondentes.
2. Executar G4 com credenciais de teste e bucket explicitamente isolado; guardar resultado sanitizado.
3. Validar A01–A19 em homologação com matriz de perfis e evidências.
4. Auditar jobs legados e dead letters por volume/identidade, sem exclusão automática ou migração destrutiva.
5. Realizar revisão de segurança de permissões, App Check, idade, privacidade, rules, custos e alertas.
6. Registrar Go/No-Go assinado por responsável técnico e responsável operacional.
7. Somente após autorização separada, planejar deploy controlado com rollback, métricas e critérios de abortar.

Não inferir que testes do Firebase Storage Emulator validam pré-condições do Cloud Storage real. Sem G4 e G6/G7 documentados, o módulo permanece **não certificado para operação**.
