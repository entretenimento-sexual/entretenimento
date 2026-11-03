# Revogação reativa de interação — perfil visitado e chat

**Data:** 03/11/2026. **Escopo:** frontend / emuladores. Sem deploy,
alteração de Firestore Rules, habilitação de Cloud Logging ou IAM.

## Fontes canônicas e privacidade

| Estado | Leitura autorizada no cliente | Autoridade final |
| --- | --- | --- |
| Bloqueio próprio de A contra B | `users/A/blocks/B` (`get` por A, `docData` reativo) | Cloud Functions `blockUser` / `unblockUser` |
| Bloqueio de B contra A | **Não** ler `users/B/blocks/A`; não revelar o bloqueador | Backend filtra resultados e nega ações pela política bilateral |
| Conexão ou solicitação pendente | Observadores reativos de relação do proprietário | Cloud Functions de amizade e envio de solicitação |
| Chat bilateral | `direct_chat_access/A/peers/B`, projeção privada sem motivo, junto a `DirectThreadFacade.canSend$` | Backend, Rules e reconciliação de disponibilidade |

A ausência de um documento de bloqueio **próprio** significa que esse
bloqueio não está ativo. Já erro ao ler o documento **não** equivale à
ausência de bloqueio: o perfil fica com ações desabilitadas, e
`ApplicationErrorService` registra o diagnóstico sem divulgar IDs em
metadados de relatório. A UI nunca infere quem bloqueou quem.

O documento do bloqueio próprio é observado **somente** para o perfil
visitado, sem scans de coleção nem consultas adicionais por item do
discovery. O listener pode gerar leituras normais do Firestore; não
ativa auditoria paga. Sua escala/custo deve ser observada em homologação
quando for oportuno.

## Critérios implantados nesta fase

- Em cada troca de alvo/usuário e em nova verificação, o estado inicial
  é não confirmado. Não reaproveitar um estado de amizade anterior.
- Bloqueio próprio ativo prevalece sobre amizade ou interesse pendente:
  ocultar botões de conversa e de nova solicitação e apresentar somente
  o estado acessível **Interação indisponível**.
- Erro em qualquer leitor de conexão impede ação até nova verificação.
  Se o bloqueio próprio for confirmado como ativo, a negação independe de
  falha dos demais observadores.
- Revogação durante uma chamada assíncrona de interesse ou preparação
  do chat cancela o feedback/navegação no cliente. Uma callable enviada
  anteriormente continua sujeita às validações do backend: cancelar
  um Observable **não** desfaz uma operação já recebida pelo servidor.
- A UI não concede permissão. Regras e Functions validam novamente
  bloqueios bilaterais e amizade quando a solicitação é executada.

## Restrições e próximas verificações

- A interface **não pode** observar em tempo real os bloqueios criados
  pelo outro usuário sem violar privacidade. Para descoberta e mídia,
  dependemos dos filtros e projeções de acesso existentes no backend.
- **Pendente:** revisar a invalidação reativa de páginas de descoberta e
  caches NgRx após mudanças de bloqueio. Não adicionar listener por card.
- **Pendente:** consolidar a verificação da amizade 1:1 sem depender
  apenas de uma lista limitada aos 24 amigos recentes para o composer,
  mantendo a projeção privada de chat como gate bilateral canônico.
- **Pendente:** teste E2E envolvendo dois usuários e bloqueio/remoção de
  amizade em outro cliente, verificando snapshots, cartões, thread e
  limites de custo. Nenhuma dessas pendências libera deploy por si.

**Regressões:** `visited-profile-friendship.facade.spec.ts` e
`other-user-profile-view.component.spec.ts`; além de toda a suíte
Angular, Firestore Rules e reconciliação de chat do Quality Gate.

**Decisão de custos pré-deploy:** [memento de auditoria Firestore](./production-release-deferred-audit-checklist.md).
