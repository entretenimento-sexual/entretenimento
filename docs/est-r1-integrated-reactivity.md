# EST-R1.4 — reatividade integrada, isolamento de sessão

Base 177cc9b3: Quality Gate / aggregate e oito workflows associados aprovados.
Revisão dirigida de fronteiras de Chat, Media, Amizades, Comunidades,
Discovery, Notificações e Auth. Não se trata de execução E2E de toda a plataforma.

- Chat: DirectChatAvailabilityService já condiciona a projeção ao owner
  autenticado, canRunChatRealtime, snapshot confirmado e startWith(false).
  Não criar outra projeção de autorização.
- Amizades: RequestsRepo mantém compartilhamento por sessão e direção;
  requests-realtime.effects encerra escutas por UID/stop. Preservado.
- Comunidades/Discovery: repositórios de leitura compartilham transporte
  via SessionReadInFlight; watchMediaIndex revoga imediatamente o estado
  anterior na troca direta de UID, preservando bootstrap inicial.
- Media: exposição de foto/vídeo passa a exigir viewerUid ativo, inclusive
  na observação de mídia própria. Nova sessão não herda grants, cooldowns
  ou cache local da telemetria. MediaTrackingSession captura objeto Auth e
  versão de encerramento e protege assinatura, respostas, erros e timer de
  qualificação. Finalizers só removem a entrada que criaram.
- Notificações: app-notification já inicia lista/contador vazios por UID.
  Resumo global de Comunidades passa a emitir estado vazio enquanto aguarda
  nova leitura, sem criar listener adicional nem substituir contagem exata.
- Auth: fonte canônica permanece AuthSessionService; não se introduziu
  novo store, alteração de Rules, quotas, backend ou concessão de acesso.

A Promise já enviada ao SDK não pode ser abortada; a proteção impede
efeitos locais tardios, não desfaz mutação remota já iniciada. Troca de
instância com mesmo UID é verificada nos pontos de execução e entrega;
a revogação imediata observável é via uid$. Permanece necessária
homologação com duas sessões, bloqueio bilateral, exclusão/restauração,
logout, troca de conta, chat e atualização de projeções no emulador.
Testes novos usam transportes simulados para respostas atrasadas, logout
durante timer, isolamento de cache, listener e resumo global. CI pendente.
