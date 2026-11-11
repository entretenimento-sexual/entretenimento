# Política operacional de admissão adulta e Termos vigentes

**Estado vigente em 10/11/2026 (Etapa 3.2C.4):** o gate separado `adultConsent v1` foi retirado dos fluxos, das Rules e das políticas locais analisadas; os contratos e builds locais foram aprovados. **Alterações ainda não comitadas nem implantadas.** A callable pública `acceptAdultConsent` foi removida do código de trabalho, mas sua retirada de produção está **bloqueada** até a decisão de compatibilidade de `adult-consent-cutover-decision-3-2c4.md`. Este documento não comprova o estado de produção nem clientes externos.

**Regra operacional atual:** declaração 18+ antes do Auth no cadastro por e-mail/senha; aceite auditável de Termos vigentes (v3 no código analisado); admissão etária canônica pelo backend; autorização por Account Lifecycle, restrições de moderação e Termos, sem reintroduzir consentimento v1 como gate. Outros provedores de autenticação e QA E2E continuam com validação pendente.


## Decisões de produto

1. **Público 18+**. Uma declaração explícita de ter 18 anos ou mais é pré-requisito do formulário inicial, anterior à criação do UID. A confirmação no navegador não prova idade. O registro canônico `age_eligibility_records/{uid}` é criado/reconciliado pelo backend depois da autenticação, sob as regras próprias.
2. **Termos vigentes**. O cadastro inicial requer aceite explícito e acesso ao aviso de privacidade. O documento `users/{uid}.acceptedTerms` começa como `accepted:false` durante o bootstrap técnico; o callable `acceptPlatformTerms` persiste a versão vigente, a data e auditoria. Não apresentar identidade técnica do Auth como conta integralmente admitida.
3. **Alterações materiais**. Ao mudar a versão (atualmente v3), apresentar resumo das mudanças, data, links para os documentos, alternativa de saída e novo aceite explícito. Ausência de reaceite bloqueia recursos sociais/adultos, não apaga dados ou conta.
4. **Elegibilidade**. SELF_DECLARED_ADULT, VERIFIED_ADULT, REVIEW_REQUIRED, DENIED_UNDERAGE e EXPIRED são estados distintos. DENIED_UNDERAGE exige restrição da conta no mesmo ato da decisão, inclusive por revisão inicial manual. REVIEW_REQUIRED nunca significa menoridade confirmada.
5. **Direitos preservados**. Contas restritas conservam rotas estritamente necessárias à leitura da própria conta, notificações, documentos, contestação e exercício de direitos. A exposição pública e as interações permanecem bloqueadas conforme a política aplicável.

## Estado do consentimento adulto v1 — política vigente

`adultConsent` e `initialAdultConsentRequired` são **campos históricos protegidos**, não requisitos de acesso, cadastro, comunidade ou Media. Contas atuais não os materializam; contas legadas podem preservá-los para auditoria e testes de compatibilidade. A rota `/adulto/confirmar` é um alias que redireciona ao fluxo canônico. Mensagens e razões de erro antigas não devem oferecer aceite extinto nem gerar aceite fictício.

A remoção de `acceptAdultConsent` na árvore local **não equivale** à autorização para excluir ou despublicar o endpoint implantado. Sem inventário de clientes distribuídos, telemetria autorizada ou outra evidência suficiente, a decisão de deploy continua **NO-GO**. Consultar `adult-consent-cutover-decision-3-2c4.md`.

## Matriz de acesso

| Situação | Admissão | Social/mídia | Destino/feedback |
|---|---|---|---|
| Checkbox 18+ ausente no formulário inicial | Não criar UID por este fluxo | Não | Campo acessível com explicação de exclusividade 18+ |
| Termos não aceitos no formulário inicial | Não criar UID por este fluxo | Não | Explicação e links para os documentos |
| UID provisório sem aceite canônico v3 | Pendente | Bloqueado | /register/aceitar-termos |
| Termos desatualizados para conta existente | Conta preservada | Bloqueado até reaceite | Informar versão, data, mudanças e solicitar novo aceite |
| Elegibilidade UNVERIFIED | Pendente | Bloqueado no onboarding | /adulto/verificar-idade |
| REVIEW_REQUIRED | Em análise | Restrição conforme lifecycle | Status de verificação / direitos da conta |
| DENIED_UNDERAGE | Proibido | Bloqueado | /conta/status e vias de revisão |
| VERIFIED_ADULT ou admissão válida conforme política, Termos v3 | Demais passos | Conforme regras de recurso | Rota solicitada |

## Fronteiras e manutenção

- `register.component` e `RegisterService.validateUserData`: barreira pré-Auth. Não é fonte de autoridade etária.
- `acceptPlatformTerms`: aceite auditável e versionado no servidor.
- `age_eligibility_records/{uid}`: autoridade etária. Não usar idade do perfil, cache ou projeções como substituto.
- `reviewInitialAgeVerification`: suspende o lifecycle quando comprova menoridade; mesma semântica da decisão por provedor.
- `currentUserCanUseAdultSocialPlatform` (Rules) e `assertInteractionAccess` (backend): autorizam o uso pela conta/lifecycle materializado e pelo registro jurídico vigente; não reconsultam a assurance etária por interação.
- `reviewInitialAgeVerification`, decisão por provedor e reverificação: devem gravar restrição no lifecycle no mesmo ato em que confirmam `DENIED_UNDERAGE`; divergências legadas exigem reconciliação administrativa controlada, não bypass da política de acesso.
- `application-error-presentation.catalog.ts`: centraliza os motivos e o texto visível. Evitar alertas duplicados no componente.

## Pendências para liberação definitiva

- Revisar todos os pontos de entrada Auth, inclusive provedores sociais, para evitar criação de identidade fora das barreiras de UX.
- Validar o corte da callable `acceptAdultConsent` com evidência de clientes distribuídos e decisão documentada; a retirada do gate v1 local já foi realizada. Não reintroduzir gravação artificial de consentimento.
- Manter a cobertura de Rules já aprovada e executar E2E/visual em emuladores **isolados**, inclusive reaceite, recusa histórica, duas sessões, menores e restrições; sem reiniciar o ambiente compartilhado.
- Avaliar a diferença entre verificação efetiva de maioridade e admissão provisória por autodeclaração em Media.
- Auditar chamadas que não passam por `assertInteractionAccess`, Storage e demais recursos.
- Validar reentrância das decisões etárias, restrições já existentes, e reparo/migração de estados canônicos legados.

**Não efetuar commit ou deploy até regressões e QA aprovados.**


## Etapa 2 — descontinuação de AdultConsent v1 como gate global

A entrada na rede adulta exige declaração 18+ no formulário, decisão de
admissão canônica registrada pelo backend, Termos de Uso vigentes e Account
Lifecycle liberado. AdultConsent v1 deixa de ser uma etapa autônoma.

- Contas existentes sem adultConsent v1 não podem perder acesso exclusivamente
  por esse campo; todos os demais bloqueios continuam válidos.
- Registro e auditoria históricos ficam preservados, sem migração destrutiva.
- A callable legada foi removida deste código de trabalho. A decisão de
  retirada do endpoint implantado permanece pendente; não reintroduzir o gate,
  não registrar aceites fictícios nem executar deploy destrutivo.
- /adulto/confirmar é alias de retorno ao onboarding canônico.
- A conclusão de perfil valida no backend Termos v3 e autoridade etária.
- Menoridade confirmada exige suspensão materializada no Account Lifecycle;
  revalidação e exceções seguem a governança da autoridade etária.
- Testes de segurança devem cobrir consentimento ausente e até explicitamente
  recusado, sem eliminar o bloqueio de menoridade/Termos.

**Manutenção:** não adicionar adultConsent ou initialAdultConsentRequired
a guards, Rules, finalização de cadastro, políticas de mídia ou de chat. Esses
campos são legados e sua presença não altera autorização.


### Compatibilidade e fronteiras adicionais
A projeção pública de perfil, o índice de nickname, a política de conexões exclusivas, a leitura de Media e a recuperação de cadastro não usam adultConsent. Campos antigos continuam legíveis apenas para auditoria. Razões de erro de clientes legados direcionam ao status da conta, nunca à tela antiga.
