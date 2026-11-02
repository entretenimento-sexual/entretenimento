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
