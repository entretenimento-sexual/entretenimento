# Governança da identidade do perfil — primeira entrega

## Política
A identidade declarada não é evidência de conduta enganosa. A alteração
legítima é possível mediante solicitação de análise, sem exigência de
assinatura. Não há exposição pública do histórico de identidade,
documentos de identificação, nome anterior ou justificativas íntimas.

Após concluir o cadastro, os campos `gender`, `declaredIdentityCode`
e `identityCatalogVersion` deixam de integrar a edição comum.
A proteção é imposta em `firestore-rules/users.rules`, no
`UsuarioService.atualizarUsuario`, no orquestrador de salvamento
e no formulário. Drafts antigos não podem reintroduzir mudanças.

## Fluxo controlado
- O usuário visualiza a identidade registrada e pode solicitar outra opção
  do catálogo canônico em controle separado, sem publicar diretamente.
- `requestProfileIdentityChange` valida autenticação, App Check, conta
  ativa, catálogo e duplicidade; grava somente um pedido pendente por UID.
- `getMyProfileIdentityChange` permite conferir o andamento sem ler
  coleções privadas diretamente. Falhas seguem tratamento de erros canônico.
- `reviewProfileIdentityChange` depende de permissão administrativa
  existente `users:suspend`, exige justificativa objetiva e aprova/rejeita
  em transação. A aprovação sincroniza `users/{uid}` e
  `public_profiles/{uid}`. Decisões ficam em `admin_logs`.
- Não alteram UID, profileId, assinatura, privilégios, vínculos, reações ou
  mensagens. Não são emitidos avisos contendo a identidade anterior.
- Uma solicitação pendente bloqueia outra; após rejeição é necessário
  aguardar sete dias para nova solicitação comum. É necessária política
  administrativa separada para decisões, recursos e mudanças estruturais
  individual ↔ casal, incluindo consentimento de ambos, quando cabível.

## Limites deste ciclo
O processo está implementado em código, mas **não implantado**. Não há
sistema administrativo visual para percorrer a fila; a chamada de revisão
exige um operador com autorização específica. Nenhum prazo de atendimento
é garantido. A validação deve cobrir build Angular, Functions, Rules
(compilação modular com `npm run rules:build`) e testes com emuladores.

Idade e nascimento não foram alterados neste ciclo. Devem receber autoridade
canônica e procedimento de correção próprio, sem usar edição arbitrária nem
expor informações sensíveis.

A comunicação social com conexões afetadas precisa equilibrar
transparência e privacidade; é **uma decisão futura**, não comportamento
implementado por esta mudança.

## Fase 2 — fila de revisão administrativa

A rota `/admin/identidades` funciona no shell e guard existentes e expõe
uma lista paginada de até 25 pedidos por chamada. Os documentos privados
`profile_identity_change_requests` não são lidos pelo frontend diretamente.
O callable `getProfileIdentityReviewQueue` exige App Check, autenticação
e permissão administrativa atual (`users:suspend`). Responde com UID,
códigos atual/solicitado, data e indicador estrutural, sem email, documentos,
orientação nem histórico íntimo. O índice composto em
`firestore.indexes.json` é requisito da operação real da fila.

A decisão usa o callable transacional existente, justificativa entre
8 e 500 caracteres, autorização novamente verificada e `admin_logs`.
Erros seguem `ApplicationErrorService`; componentes usam RxJS.

Qualquer transição envolvendo casal, inclusive entre composições diferentes,
não pode ser aprovada por este fluxo:
exigem procedimento e consentimento próprios. O bloqueio está no
backend, independente do botão desabilitado no painel. Rejeição
fundamentada continua possível. Não há divulgação pública de
identidades anteriores ou modificação automática dos vínculos.

Permanecem pendentes o procedimento próprio para composição de casal,
contestação formal e a validação integrada em emuladores com índice,
token/role revogado e concorrência de revisão. Nenhum deploy foi feito.
