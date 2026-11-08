# Issues #235/#236 — Etapa 3: identidade do autor no Mural e comentarios

## Escopo e decisao

O adaptador compartilhado `buildCommunityPublicAuthor` e a fronteira de apresentacao de identidade do autor em:

- `community-feed-read.service.ts` (publicacoes e referencias a publicacoes respondidas);
- `get-community-feed-comments-page.handler.ts` (comentarios e referencias citadas);
- `get-community-feed-comment-replies-page.handler.ts` (respostas a comentarios).

Se o `public_profiles/{uid}` contiver **qualquer uma** das 21 chaves de interesse privado legadas, mesmo `null`, o adaptador gera uma identidade neutra com `label/nickname=Participante`, `profileId=null`, `avatarUrl=null`, sem municipio, estado ou identidade. O fallback antigo guardado na projecao nao pode recuperar nickname ou avatar. O conteudo publicado e preservado pela politica existente; esta etapa protege **a identidade hidratada**, nao despublica textos ou imagens de mural.

A deteccao usa `hasLegacyPrivateDiscoveryFields` da politica canonica, sem duplicar a lista de campos. Perfil limpo ou ausente continua usando o comportamento anterior. O novo metodo mantem o nome e o contrato de retorno existentes, sem alteracao da camada Angular.

## Garantias e limites

- A quarentena bloqueia a identidade publica hidratada no backend em novas leituras; nao modifica documentos de Firestore nem apaga midia.
- Testes compilados verificam os 21 campos, incluindo valores `null`, e rejeitam a exposicao de fallback antigo. Um contrato source documenta o uso do adaptador em mural, comentarios e respostas.
- Um contrato source nao e um E2E de sessao Angular. Consultas em cache anteriores, dados ja presentes em browser/IndexedDB e assinaturas de URLs existentes **nao sao revogados por este patch**.
- Nenhum resultado desse pacote autoriza recuperacao persistente, sanitizacao real, deploy ou encerramento da Issue #236.

## Aceite visual pendente — Issue #235

Usar A/B adultos sinteticos em duas sessoes independentes, com Auth/Firestore emuladores isolados, sem dado real:

1. Confirmar que um perfil limpo e exibido normalmente em Discovery, mural, comentarios, respostas e perfil visitado.
2. Criar um perfil sintetico com chave legada apenas no emulador descartavel, mantendo os demais atributos publicos presentes.
3. Em nova leitura, confirmar que autor do mural, comentario e resposta aparece como **Participante**, sem identificador social, avatar antigo, municipio, preferencia ou dados de fallback.
4. Inspecionar payloads e Network; nenhum dos 21 campos deve aparecer em respostas.
5. Reabrir item, navegar ida/volta e verificar que caches da sessao nao reapresentam identidade anterior. Se reapresentarem, abrir defeito de invalidacao de cache Angular; a etapa 3 nao o resolve.
6. Repetir bloqueio A -> B e B -> A, inclusive URL direta, midia, mensagem pendente, mensagens ja existentes e outra aba do mesmo usuario.
7. Conferir acessibilidade, retorno de navegacao, loading/error/retry e error handlers centralizados.
8. Anexar evidencias higienizadas sem UID ou preferencia privada real antes de fechar #235.

## Gates

- `node --test scripts/tests/issue235236-community-feed-author-quarantine.contract.test.mjs`
- `npm --prefix functions run build`
- `cd functions && node --test lib/community/community-public-author.model.test.js`
- Firestore Rules, auditoria de orfaos e inventario read-only.
- CI no Ubuntu e Windows, sem credenciais ou acesso de producao.

## Situacao

`ISSUE235_236_STAGE3_LOCAL_PENDING / REAL_DATA_BLOCKED / ANGULAR_UI_QA_PENDING`
