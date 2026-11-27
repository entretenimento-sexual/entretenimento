# CHAT-R1.10.3.4.3D.5.2A — shared friends observation

Base: 07da3d4944072a75e09700b561fd809e4f26454d.

Incremento inicial: FriendsRepo.watchFriends mantém a assinatura pública. Um listener por identidade operacional e tamanho de página, dentro da mesma instância da aplicação. A última projeção bruta ativa é compartilhada, mas a hidratação pública concluída não é armazenada. Novos consumidores repetem a validação pública ou ingressam em hidratação simultânea. A última desinscrição libera o listener. Novos snapshots descartam hidratações anteriores. Revogação ou substituição de instância de autenticação encerra a observação com erro tipado; os consumidores mantêm seus caminhos de erro existentes.

As leituras pontuais, paginação, autorização backend, regras, polling de solicitações e limites permanecem intactos. Não há compartilhamento de dados entre abas. A certificação deverá verificar os consumidores reais, o tratamento de troca de sessão com mesmo UID e a recuperação do estado de amizade, além das contagens de listeners e hidratações. Não considerar a projeção local uma nova autoridade de autorização.

A matriz multinavegador de UX permanece separada.

## D.5.2A.1 — consumer lifecycle

AuthSessionService now emits replacement User instances even with unchanged UID/e-mail, while uid$ still deduplicates. The store watch rebinds and clears its observed list on replacement, recovers technical errors using the existing 60-second contingency interval and centralized ApplicationErrorService; normal revocation is not a technical incident. The profile facade revalidates all three relationship sources on identity replacement and emits an unverified state first. Public-profile hydration failures in realtime observation propagate as unknown rather than successful empty results; one-shot semantics are unchanged. Remaining point-in-time reads, paginated state and real browser resource counts require separate audit; no cross-browser certification is inferred.

## D.5.2A.2 — quantitative certification and CI publication

Opt-in DEBUG_FRIENDS logical resource events contain only a document-local sequence, page size, snapshot ordinal and open/close category. They contain no UID, payload, token or authorization information. The real SPA suite measures bootstrap, two profile mounts, profile disposal, and explicit logout; it requires a single listener with two concurrent consumers, no simultaneous duplicate hydration for the same snapshot, balanced teardown and zero unmatched closures. Counts are RxJS lifetimes, not physical Firebase operations or invoices. Chromium three replicas are explicitly enabled on this branch; cross-browser UX certification remains independent.

Quality Gate aggregate evaluation checks all 15 required outcomes. A cancelled run does not publish a new aggregate status; missing/skipped required checks on a completed run fail closed. Native workflow status remains authoritative for cancelled runs. No historical status is rewritten by this patch.

## D.5.2A.2 — correction of route-specific certification

All three Chromium replicas of 272632ac failed at the shared-friends bootstrap assertion. Their artifacts show one active listener, two active consumers, hydration peak one, no active hydration at the end of the bootstrap observation, and 181 recovered messages per replica. The initial home route legitimately mounts both the session NgRx observer and PrincipalFeedService.loadConnectionOwnerUids$ for personalized media. The previous expectation of one consumer on that route was incorrect. The certification now explicitly checks two consumers on home, one on Chat and friend-request/list routes after home teardown, two on visited profiles, one after profile disposal, and zero resources at logout. The single-listener, no overlapping hydration and balanced-close assertions remain unchanged. Failed samples now print the actual counters. No production source or authorization policy changes in this correction; full browser recertification remains required.
