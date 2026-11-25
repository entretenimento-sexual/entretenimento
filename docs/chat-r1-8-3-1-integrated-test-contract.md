# CHAT-R1.8.3.1 — contrato integrado de disponibilidade

Base: cf94bc3951c37752ee523f69b2bd4f22d7a1af22. Quality Gate 45663461655, job 139379188073: 2026-11-25 17:22:30 UTC, 3312 testes passaram e 1 falhou (525/526 arquivos). direct-chat.facade.spec.ts 12/12, public-video-chat-share-dialog.component.spec.ts 7/7. Falha em direct-thread.facade.spec.ts:54 (observeMessages$ 0 chamadas em vez de 1), erro não tratado TypeError: this.availabilityService.observeForCurrentUser$ is not a function. O mock do teste integrado expunha apenas observe$. A etapa do workflow tinha conclusion success por continuidade de execução, apesar do exit code 1 da suíte; não representa aprovação.

## Auditoria direcionada
| Consumidor | Contrato verificado |
| --- | --- |
| DirectChatFacade (selecionado e não selecionado) | observeForCurrentUser$(peer, owner) |
| user-card (Amizades, Discovery, Online) | observeForCurrentUser$(targetUid, currentUid) |
| other-user-profile-view | observeForCurrentUser$(peer, owner) |
| modal-mensagem | observeForCurrentUser$(peer), contexto implícito de sessão |
| public-video-chat-share-dialog | observeCanSendToChat$ na facade, sem acesso direto à projeção |
| DirectThreadFacade | selectedChatAccess$ da facade, leitura separada de envio |
| Specs do card, perfil visitado e modal | mocks já expõem observeForCurrentUser$ |
| Spec de DirectChatFacade | doubles tipados pela assinatura do serviço |
| Spec de DirectThreadFacade | passa a exercitar o método real, simulando authUid$, canRunChatRealtime$ e observe$ |

Busca remota por símbolo retornou zero resultados; auditoria por árvore e arquivos conhecidos, não um grep integral de checkout. A suíte completa da CI é a validação complementar obrigatória.

## Regressão reforçada

O teste integrado conserva todas as expectativas originais: histórico legível sem amizade, envio negado, preservação do listener após mudança de amizade, bloqueio removendo escopo e histórico, ausência de recuperação antes do snapshot canônico, restauração autorizada e logout. Acrescenta perda/retomada do gate de elegibilidade de envio, ausência de consulta bilateral quando desabilitado, identidade do par, cancelamento da observação e ausência de restauração da seleção após novo login com o mesmo UID. A simulação de leitura não comprova autorização de Firestore no servidor; a EST-R1.5.1 e os E2E continuam sendo a cobertura complementar.

Sem mudanças no código de produção, Firestore Rules, Functions, rate limits, tratamento de erros ou fontes canônicas. Não se reduz nenhuma asserção do teste anterior. A nova CI precisa aprovar integralmente antes de CHAT-R1.8.4. Sem execução local da suíte ou deploy.
