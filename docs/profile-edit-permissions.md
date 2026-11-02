# Matriz canônica de permissões para alterações do perfil

> Estado: implementação existente na `main` e pendências explícitas. Esta
> matriz descreve o contrato técnico **atual**, não autoriza novos privilégios,
> não substitui as Firestore Rules nem inventa operações administrativas.
> Aplica-se a contas `free`, `basic`, `premium`, `vip` e ao papel
> administrativo. O acesso real considera lifecycle, elegibilidade, bloqueios,
> consentimentos e assinatura válida — nunca somente o valor de `role`.

## Interpretação da matriz

- **Titular**: usuário autenticado que controla a própria conta.
- **Equipe autorizada**: operador cuja permissão é validada por backend.
  O cargo isolado não equivale à assinatura nem permite editar qualquer campo.
- **Backend**: Cloud Functions/Admin SDK com validação e auditoria próprias;
  esse privilégio não deve ser repassado ao navegador.
- **Somente leitura**: é exibido, mas não oferece escrita ordinária.
- **Excepcional/PENDENTE**: não há endpoint aprovado; não significa que a equipe
  já consegue fazer a operação.

## Quem pode alterar o quê

| Campo / autoridade | Cadastro inicial | Titular após cadastro | Equipe / backend | Condições e exposição |
| --- | --- | --- | --- | --- |
| Nickname (nome de exibição) | Titular escolhe no onboarding com unicidade consultada | **Não**; exibido `readonly` | Correção excepcional **pendente**; backend deverá validar e auditar | Não depende de assinatura, amizade nem aprovação comercial |
| `nicknameNormalized`, `nicknameHistory` | Gerados pelo fluxo de cadastro | **Não** | Backend apenas, nos fluxos específicos | Índice técnico não é um campo de apresentação editável |
| `public_index/nickname:*` | Reserva atômica elegível e correspondente à projeção pública do titular | Não pode criar aliases, editar ou excluir chaves existentes | Backend de ciclo de vida reconcilia índice | Reserva perpétua e unicidade contra todo cliente malicioso ainda **pendentes** |
| `profileId` e UID | Backend gera identificador opaco estável | **Não** | Backend no registro/reparação controlada | Não derivar ID social do Auth UID |
| Identidade individual (`gender` / `declaredIdentityCode`) | Titular escolhe no onboarding | Por callable com confirmação e 90 dias; **havendo conexão social, vai para revisão** | Equipe autorizada pode revisar pedido `PENDING`, com justificativa | Mudança aprovada atualiza descoberta e projeção; não pressupor fraude nem expor histórico íntimo |
| Composição de casal | Titular declara no cadastro | Mudança estrutural **bloqueada** | Fluxo com consentimento das pessoas **pendente** | Não usar revisão individual para alterar composição |
| Orientação e orientações de casal | Titular informa | Titular, no formulário aplicável | Moderação somente por fluxo autorizado | Não altera identidade canônica nem prova maioridade |
| Idade exibida no perfil | Titular informa, quando aplicável | Titular, intervalo informativo 18–100 | Autoridade de idade permanece backend | Idade exibida **não** concede elegibilidade 18+ |
| Verificação etária, maioridade, consentimentos regulatórios | Fluxos específicos de onboarding | Sem edição direta de autoridade | Backend de elegibilidade/compliance | Sempre privados ou com projeção minimizada |
| Descrição pública / `descricao` | Titular escreve | Titular edita livremente dentro de limites/moderação | Moderação quando justificada | Só projeta com `publicDescriptionVisible=true`; não publicar legados sem opt-in |
| Foto de avatar | Titular seleciona | Titular altera pelo fluxo de mídia | Moderação e processamento backend | Respeita quarentena, lifecycle e segurança de storage |
| Localidade ampla (`estado`, `municipio`) | Titular informa | Titular edita | Backend pode projetar localização aproximada | Coordenadas exatas e endereço privado não são públicos automaticamente |
| Intenções, busca e traços declarados | Titular preenche campos opcionais | Titular conforme capacidades do plano | Backend projeta apenas campos autorizados | Free deve autorizar badges gerais ao gravar; busca de gêneros, disponibilidade e práticas íntimas têm controles próprios |
| Modo de descoberta | Padrão | `standard` para free/Basic; `discreet` exige Premium; `priority` exige VIP | Rules e backend validam entitlement | Papel administrativo não concede benefício financeiro automático |
| Perfil `publicVisibility` e `interactionBlocked` | Controlados durante registro e lifecycle | **Não** por atualização Firestore comum | Backend/moderação com autoridade específica | Free não compra ocultação privilegiada; suspensão/segurança continuam disponíveis |
| Publicação de fotos e vídeos | Não é direito implícito do cadastro | `PUBLIC` sob moderação; nova audiência `FRIENDS` requer Basic+ válido | Backend autentica, modera e autoriza | Nunca converter mídia privada legada em pública no downgrade |
| Assinatura, `role`, `tier`, billing, entitlements | Inicializados sem privilégio | **Não** | Billing backend, sem carteira client-side | Admin não herda assinatura e não pode inventar entitlement |
| Bloqueios, suspensão e ciclo de exclusão | Autoridade backend | Apenas solicitações/ações explicitamente autorizadas | Equipe de moderação com permissão específica, backend | Proteção contra bypass e auditoria de eventos |
| E-mail, autenticação, documentos e mensagens | Fluxos privados específicos | Atualizações somente pelo fluxo canônico respectivo | Backend conforme finalidade autorizada | Não publicar em `public_profiles` nem no discovery |

## Fluxos e quem decide

1. **Atualização ordinária**: `ProfileEditSaveOrchestrator.save$` /
   `UsuarioService.atualizarUsuario` enviam somente campos permitidos.
   A UI pode ocultar controles, mas `firestore-rules/users.rules` é
   barreira contra clientes adulterados.
2. **Identidade**: `requestProfileIdentityChange` verifica App Check,
   estado do perfil, cooldown e vínculos. Mudança sem conexões elegíveis
   aplica em transação; havendo vínculo, cria `PENDING` e aguarda
   `reviewProfileIdentityChange`. A equipe precisa de autorização
   `users:suspend` e justificativa registrada em auditoria.
3. **Nickname**: não há operação de renomeação de perfil concluído.
   O índice `public_index` recebe somente chave correspondente à
   `public_profiles` do titular, não aliases arbitrários. O trigger
   `onUserCreateIndexNickname` reconcilia *somente* índices nickname.
4. **Visibilidade**: `users/{uid}/preferences/profile` é documento
   privado. `syncPublicPreferenceProjection` sanitiza a projeção.
   `showPreferenceBadges` para free exige escolha expressa; isso não
   publica preferências íntimas sem consentimento separado.
5. **Moderação e billing**: somente backend autorizado pode alterar a
   autoridade de suspensões, assinatura e elegibilidade; auditoria deve
   preservar motivo, ator e trilha de alterações.

## Regras de qualidade e manutenção

- Toda mudança de campo ou permissão deve atualizar **esta matriz**, o
  comentário no ponto de enforcement, os testes de Rules e o contrato Angular.
- Não trocar nomes públicos de funções/serviços sem plano de compatibilidade.
  Frontend continua reativo (Observables), com erros centralizados por
  `GlobalErrorHandlerService`, `ApplicationErrorService` e
  `ErrorNotificationService`.
- Revisão administrativa exige autenticação, permissão backend, motivo e
  trilha auditável. Atribuir `admin` ao documento não basta.
- Pagamento concede capacidades, não direito a alterar histórico, reescrever
  identidade, ocultar dados íntimos de outros ou contornar moderação.
- Campos publicados precisam de consentimento e projeção mínima. Dado não
  preenchido permanece ausente; downgrade não torna privado em público.
- Não conceder autorização de edição pelo simples fato de um campo existir
  em `public_profiles`: este é um espelho consultável, não a autoridade.

## Limites atuais / trabalho ainda necessário

**P1 — Nickname:** `nicknameNormalized` na criação de `public_profiles`
ainda depende da normalização do onboarding client-side. A Rule impede aliases
desconectados da chave declarada, mas não consegue comprovar a normalização
Unicode nem garantir reserva histórica. Migrar a reivindicação para callable
transacional, validar a chave de origem no servidor, fazer backfill de legados
e definir retenção/eliminação conforme privacidade e exclusão de conta.

**P1 — Governança da identidade:** históricos de amizade encerrada antes
da gravação do marcador ainda exigem migração. A revisão atual não comprova
automaticamente a veracidade das declarações; não inferir fraude.

**P2 — Preferências públicas:** especificar quais campos opcionais podem
ser divulgados no free e quais exigem consentimento próprio; migrar legados
sem divulgação tácita e rever as superfícies de discovery no downgrade.

**Validação:** o commit `9d6967a` teve Quality Gate com falhas em
auditoria de Functions, lint e boundary visual. As falhas não devem ser
suprimidas. Verificar resultados dos commits posteriores; não afirmar
homologação sem CI verde. Nenhum deploy está autorizado por este documento.

## Implementação do backend transacional — etapa P1

Os novos callable names `reserveRegistrationNickname` e
`completeRegistrationProfile` são backend-only, com App Check, autenticação,
normalização canônica no servidor e transação que compara:
`users/{uid}`, `public_index/nickname:{key}` e a nova reserva privada
`nickname_reservations/{key}`. O backend aceita somente a chave normalizada
que ele próprio calculou; o navegador não pode informar uma segunda key.
Ambas as operações impedem ocupação por outro UID e troca do nickname
estabelecido. A conclusão também verifica e-mail no Firebase Auth, termos,
consentimento adulto e registro canônico de admissão etária, sem usar
um campo de idade de apresentação como autoridade.

Os serviços reativos Angular **mantêm os mesmos métodos** de cadastro, mas
passam a chamar essas Functions; as falhas continuam encaminhadas aos serviços
centralizados de erro, sem liberar o cadastro em caso de ausência do backend.
`nickname_reservations` é coleção privada e bloqueada para cliente pelas
Rules padrão. As reservas históricas existentes permanecem consultadas via
`public_index`, para evitar tomar apelidos já usados.

**Implantação coordenada obrigatória:** publicar as duas Functions e testar
cadastro por e-mail e social antes de bloquear os caminhos legados de escrita
direta das Rules. Até essa etapa de rollout, as Rules de conclusão antigas
continuam aceitando o batch de cadastro, que é uma lacuna residual conhecida.
Não alegar exclusividade absoluta do servidor até fechar essa permissão,
migrar históricos de nicknames e comprovar CI e E2E.

Os registros privados de reserva exigem política de retenção para contas
excluídas e atendimento a solicitações de privacidade. Não usar o índice
para identificar pessoas fora da plataforma nem reter PII desnecessária.

## Produção / rollout seguro da autoridade de nickname

A reserva transacional nova está implementada, mas **não pode** ser implantada
por atualização indiscriminada das Rules. Ordem operacional exigida:

1. Publicar somente os callables `reserveRegistrationNickname` e
   `completeRegistrationProfile` junto à versão compatível de Functions,
   observando App Check, Auth, testes de admissão 18+ e log de auditoria;
2. Validar cadastro por e-mail, social, colisão de nickname, repetição pelo
   mesmo UID, contas não elegíveis e rollback do cadastro; então liberar o
   cliente Angular que consome os callables reativos;
3. Migrar/conciliar índices e reservas de usuários existentes. Nunca atribuir
   nickname ocupado a UID novo; apontar conflitos para auditoria;
4. **Só depois** bloquear por Firestore Rules a conclusão do perfil e criação
   do índice por cliente, fechando o bypass legado. Confirmar testes de
   rollback, reconciliação e índices de busca. Não ampliar leitura da coleção
   privada `nickname_reservations`.

A ordem de publicação é uma dependência de segurança e disponibilidade:
o Angular novo depende de Functions novas, mas o frontend antigo deve
continuar compatível durante a transição. Não liberar produção sem
homologação do Quality Gate completo e E2E de cadastro.

### Dependências Functions — reconciliação rastreável

Workflow `functions-security-dependency-reconciliation.yml` atualizou
`functions/package.json` e `functions/package-lock.json` no commit
`bb79e6e` com overrides reproduzíveis para `follow-redirects@1.16.2`,
`glob@14.0.2` e `minimatch@11.0.1`.
A execução específica aprovou auditoria `--omit=dev`, lint e
build/testes das Functions; isso **não** é prova de aprovação dos testes
Angular, Rules ou E2E integrados na revisão atual. O push automatizado
pode não iniciar o Quality Gate, exigindo um commit normal para validar.

### Gate de exports e semântica visual do cadastro

As Functions `completeRegistrationProfile` e `reserveRegistrationNickname`
foram classificadas explicitamente no contrato de exports permitido e exigido;
seu App Check, autenticação e políticas de autorização são obrigatórios.
A nomenclatura CSS de apresentação pública foi padronizada como
`profile-public-bio-toggle` e `other-profile-page__about-header`, evitando
terminologia genérica de introdução/descrição. Não houve mudança nos seletores
de consentimento nem exposição implícita de textos privados.

### Reserva backend-only: fronteira explícita

`firestore-rules/nickname_reservations.rules` nega todas as leituras e
escritas de cliente em `nickname_reservations/{key}`, independentemente de
assinatura, cargo, titularidade ou conclusão do cadastro. Somente operações
Admin SDK com autorização backend podem criar/reconciliar a reserva. Os testes
cobrem GET, SET e DELETE negados para o titular. Não expor a existência da
reserva em páginas públicas nem no mecanismo de descoberta.

### Reconciliação de índices anteriores — ferramenta segura

`scripts/maintenance/backfill-nickname-reservations-admin.mjs` faz um
levantamento paginado de `public_index/nickname:*` e compara:
índice público existente, titular privado, normalização canônica compilada
e reserva backend-only. O padrão é **dry-run**, sem alterações. Não recupera
apelidos por e-mail e não cria qualquer perfil ou publicação.

Preparação local:
```powershell
npm.cmd --prefix functions run build
$env:FIREBASE_PROJECT_ID = 'ID_DO_PROJETO'
$env:NICKNAME_RESERVATION_DRY_RUN = 'true'
node scripts/maintenance/backfill-nickname-reservations-admin.mjs
```

Uma eventual execução real exige planejamento operacional, credenciais
Admin, `NICKNAME_RESERVATION_DRY_RUN=false`,
`NICKNAME_RESERVATION_APPLY=true` e
`NICKNAME_RESERVATION_CONFIRM_PROJECT=ID_DO_PROJETO`.
**Não executar a aplicação sem revisar o relatório, garantir acesso ao
backup e validar a sequência de deploy.** O script é idempotente,
não reassocia, remove ou libera nicknames; conflitos e ausências exigem
revisão manual. Limite padrão: 1.000 registros; paginação e teto configuráveis.
A ferramenta não executa automaticamente em CI nem foi rodada em produção.


### Referência comparativa e aceite jurídico vigente

Documentação pública resumida em docs/references/sexocomcafe-public-policy-review.md.
O material do concorrente não altera automaticamente as regras da plataforma.

O backend de cadastro passa a exigir a versão vigente dos termos, a
confirmação de ciência da privacidade e o consentimento adulto canônico.
A reserva não pode ser realizada por conta suspensa, bloqueada,
desativada ou em exclusão. Testes E2E específicos validam cenários
negativos em emuladores. A homologação exige CI integralmente verde.

Dados básicos do perfil podem ser publicamente consultáveis conforme a
autoridade da plataforma, mas detalhes de vida sexual e preferências
íntimas não devem ser publicados automaticamente por a conta ser free.


## Cutover candidate de Firestore Rules — emulador, não produção

Ferramenta: scripts/maintenance/build-registration-lockdown-candidate.mjs.
Lê os fragmentos do manifesto canônico e produz **somente em memória**
uma versão estrita, sem alterar firestore.rules, deploy ou banco de dados.

Esta versão desativa exatamente três caminhos de escrita via SDK:
- users/{uid}: auto-conclusão do perfil; continua permitida a edição ordinária.
- public_profiles/{uid}: criação client-side; backend Admin SDK faz a projeção.
- public_index/nickname:*: criação client-side; email:* mantém seu contrato.

O E2E de emulador registra tentativas de concluir cadastro, criar projeção
e indexar nickname diretamente: todas devem ser negadas. Também prova que
a descrição ordinária ainda pode ser alterada e que a reserva privada não
fica legível. O gerador falha se qualquer âncora mudar, impedindo testes
enganosos sobre Rules diferentes das esperadas.

**Critério de ativação em produção:** Functions de cadastro implantadas,
clientes antigos tratados com versão mínima compatível, dry-run integral
e conciliação de nicknames legados revisados, plano de rollback, aprovação
de segurança e CI do cutover. Somente depois promover manualmente as três
alterações aos fragmentos versionados. Nenhum teste emulador equivale a
autorização de deploy. A coleção privada não deve ser exposta.


### Aprendizado com verificação de perfis de casal

O artigo oficial do Sexlog sobre Selo Real relata que mudanças estruturais
de perfil conjunto podem exigir comprovação das duas pessoas. Referência:
https://support.sexlog.com/hc/pt-br/articles/200894068-Selo-Real-Como-pedir-o-meu

Decisão do Entretenimento: a inserção/retirada de co-titular de casal
continuará **bloqueada** até existir fluxo com consentimento individual,
auditoria, política de prova mínima, prazo de retenção e revogação
executáveis. Não confundir validação de casal com verificação de
maioridade nem presumir que mudança de identidade individual seja fraude.
A assinatura não substitui qualquer dessas autoridades.
