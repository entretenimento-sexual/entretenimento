# Correção operacional — Termos e consentimento adulto (09/11/2026)

> **DOCUMENTO HISTÓRICO.** As etapas descritas abaixo foram a correção de 09/11/2026 e **não representam o fluxo vigente**. Em 10/11/2026, o gate `adultConsent v1` já foi retirado da implementação local, mas ainda não há commit ou deploy. A callable `acceptAdultConsent` foi removida do código de trabalho e **sua despublicação não está autorizada** enquanto a compatibilidade de clientes antigos não for verificada. Consultar `adult-admission-legal-gating.md` e `adult-consent-cutover-decision-3-2c4.md`.

## Regra vigente após a Etapa 3.2C.3

A conta elegível deve possuir Termos vigentes e admissão etária canônica, com as restrições do Account Lifecycle preservadas. Ausência, recusa ou versão antiga de `adultConsent` não cria bloqueio adicional. O campo histórico não deve ser atualizado nem sintetizado para liberar acesso. A URL `/adulto/confirmar` somente redireciona ao onboarding canônico. A execução funcional E2E e os caminhos alternativos de Auth permanecem pendências separadas. As referências abaixo ao aceite v1 descrevem o **comportamento anterior**, não uma instrução de aplicação.

---

## Registro histórico da correção anterior — não executar como fluxo vigente

## Diagnóstico
Conta legada com `acceptedTerms.accepted: true`, mas sem `version: v3` e `acknowledgedPrivacyNotice: true`, chegava a `/adulto/confirmar` e recebia `functions/failed-precondition`.
A configuração `dev-emu` pulava a barreira jurídica no frontend, enquanto a Function exigia registro persistido. Havia ainda incoerência entre guard e backend para contas ativas com consentimento pendente.

## Contratos preservados naquele reparo (históricos)
- `acceptedTerms.version = v3` e ciência explícita da privacidade precisam ser persistidos pela callable `acceptPlatformTerms`.
- `adultConsent.version = v1` é persistido por `acceptAdultConsent`; a função já é idempotente para aceite adulto vigente.
- `initialAdultConsentRequired` ausente não é prova de aceite; só `false` ou aceite adulto vigente dispensam a etapa conforme o guard atual.
- O backend usa `age_eligibility_records` como autoridade. O frontend reconcilia esse estado antes de solicitar o clique ainda pendente em conta ativa.
- `dev-emu` agora exercita o fluxo jurídico real via Functions Emulator. `dev-real` não foi alterado (bypass de desenvolvimento permanece e não serve para E2E jurídico).
- Não há criação automática de aceite `v3` a partir do registro histórico; deve existir manifestação explícita.
- Não modificar dados de usuário manualmente, não excluir contas e não usar deploy em produção neste reparo.

## Validações locais daquele reparo (históricas)
1. `git diff --check`, compilação Angular e Functions, testes focados de compliance.
2. Conta legada: deve apresentar Termos v3 antes do consentimento, registrar aceite em Firestore e gerar auditoria apropriada.
3. Se falta elegibilidade canônica, encaminhar à verificação etária, sem gravar consentimento adulto.
4. Após aceite adulto, `adultConsent.accepted = true`, `version = v1`, `initialAdultConsentRequired = false`; redirecionamento para dashboard.
5. Reload e sessão independente: não repetir etapas já válidas.
6. Recusa/error: sem loops, sem `NG0100`, sem duplo feedback; preservar tratamento centralizado.
7. Testes da Issue #235 apenas depois do QA desta correção.

## Limites
Este patch não altera Cloud Functions nem Firestore Rules, não cria migrador automático e não executa ensaios de navegador. A verificação funcional depende do emulador já ativo.

## Complemento histórico: redirecionamento e feedback anteriores
- Ordem: Termos v3 persistidos, elegibilidade canônica, consentimento v1 persistido e destino protegido.
- Perfil concluído não equivale a consentimento nem dispensa a reconciliação ao solicitar um aceite pendente.
- O marcador initialAdultConsentRequired=false não substitui adultConsent.accepted=true na versão vigente.
- A página etária só retorna ao destino após reconciliação backend ou confirmação explicitamente persistida. Os guards escolhem o próximo passo.
- Falhas de precondição da callable de consentimento adulto possuem reason/recommendedAction para feedback e CTA sem inferir que o aceite já ocorreu.
- A política de admission atual ainda admite SELF_DECLARED_ADULT canônico para onboarding, sem equiparar esse estado à verificação confiável usada por Media. A eventual proibição dessa admissão exige revisão separada do contrato e das regras de autorização.


## Decisão superveniente — Etapa 2 (substitui o fluxo anterior)
A política posterior retirou consentimento adulto independente do gate
global. Manter histórico e auditabilidade. A autorização passou a depender
de Termos vigentes, admissão canônica 18+ e Account Lifecycle.
A antiga rota /adulto/confirmar fica como alias de compatibilidade.
Nenhuma atualização fictícia dos campos adultConsent é permitida.
