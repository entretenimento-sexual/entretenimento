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

## CHAT-R1.8.3.2 — recuperação da integridade dos testes

Quality Gate do commit 113cf29219bbc91930be6e0b284ba059638dc527 (run 45664641472): aggregate failure, ANGULAR_TESTS failure. O arquivo direct-chat.facade.spec.ts foi corrompido na substituição anterior porque a sequência dólar seguida de aspas simples tem significado especial em String.replace. O compilador registrou TS2339, TS1002 e TS1005. O build Angular, Firestore Rules (390/390), reconciliação e E2E bilateral (incluindo EST-R1.5.1) passaram; a suíte Angular não executou os testes corrigidos.

Reconstrução a partir do arquivo íntegro em cf94bc3951c37752ee523f69b2bd4f22d7a1af22, com substituições literais por split/join, contagem esperada de ocorrências e verificação reversível byte a byte. A tipagem do mock permanece baseada na assinatura pública observeForCurrentUser$. A auditoria comparou todas as declarações de testes e asserções expect dos dois arquivos com a base íntegra: direct-chat 75 asserções mantidas; direct-thread 77 originais mantidas e 16 adicionais preservadas. O direct-thread.facade.spec.ts permanece inalterado neste commit. Nenhuma mudança de produção, regras, funções ou limites. A aprovação da nova CI continua obrigatória antes da CHAT-R1.8.4. Não houve execução local da suíte Angular completa.
