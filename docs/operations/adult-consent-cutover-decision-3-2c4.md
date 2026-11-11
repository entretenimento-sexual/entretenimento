# Decisão de corte e compatibilidade — `acceptAdultConsent` (Etapa 3.2C.4)

**Estado:** NO-GO para despublicação/remoção em produção, commit de consolidação e deploy, enquanto os critérios abaixo permanecerem sem evidência ou autorização. Data: 10/11/2026. Repositório local declarado: `main` em `bf14b026`, com alterações ainda não comitadas.

## O que foi confirmado na auditoria estática

- `acceptAdultConsent` foi removida do código de trabalho (`functions/src/compliance/adult-consent.handler.ts` e export de `functions/src/compliance/index.ts`). A expectativa de exportação também foi retirada de `scripts/quality/check-functions-exports.mjs`.
- A implementação local passou a usar Account Lifecycle, Termos v3 e admissão etária canônica, sem gate adicional de `adultConsent v1` nos fluxos auditados.
- Os builds e contratos locais aprovados **não demonstram** que aplicativos, páginas em cache ou clientes publicados deixaram de chamar `acceptAdultConsent`.
- Não foi feita consulta de telemetria de produção, inventário de versões distribuídas, análise de chamadas reais nem inspeção autorizada da implantação. A existência e o uso atuais do endpoint implantado são **desconhecidos**.

## Invariantes de segurança

1. Nunca transformar `adultConsent v1` em nova autoridade etária ou gate de produto.
2. Nunca gravar aceites fictícios ou alterar `adultConsent` e `initialAdultConsentRequired` históricos para contornar bloqueios.
3. Maioridade confirmadamente negada, suspensão, moderação, bloqueios do Account Lifecycle e Termos não vigentes continuam impedindo ações.
4. Não excluir Functions implantadas de modo acidental num deploy amplo. Não presumir que ausência de referência no código atual significa ausência de clientes antigos.
5. Preservar as nomenclaturas públicas e o tratamento centralizado de erros. Uma eventual resposta de compatibilidade não deve prometer liberação nem mascarar ausência de elegibilidade.

## Inventário e decisão obrigatórios, antes de qualquer deploy

| Item | Evidência a registrar | Situação em 10/11/2026 |
|---|---|---|
| Clientes distribuídos | Versões web, bundles armazenados/cache, clientes e integrações ainda capazes de chamar a callable | Pendente |
| Endpoint implantado | Existência, região, geração, configuração de rollout, forma de despublicação | Pendente |
| Uso real | Janela autorizada de observação, volume de chamadas, respostas e ausência ou presença de clientes legados | Pendente |
| Estratégia de compatibilidade | Manter provisoriamente a callable, adaptar para redirecionamento seguro ou remover após janela; decisão de responsável técnico | Pendente |
| Política de dados | Não persistir novo `adultConsent v1`; manter documentos históricos protegidos e trilha de auditoria | Estabelecida para o código local |
| Plano de rollback | Recuperar endpoint/versão anterior sem reabilitar o gate antigo nem retroceder proteções de menores | Pendente |
| E2E/CI isolados | Fluxos sem v1, históricos, Termos, duas sessões, Media, comunidades, menoridade, moderação, link legado, outros Auth | Pendente |

## Critério de liberação

**NO-GO** enquanto não houver decisão explícita sobre clientes e endpoint, plano de rollback e evidência funcional isolada. Depois de evidenciar os itens, registrar escolha e responsáveis antes de alterar a superfície de deployment. Não executar `firebase deploy` ou funções que possam remover endpoints por ausência de export.

**GO condicionado:** somente após inventário, compatibilidade aprovada, testes e revisão de escopo, com autorização explícita do responsável. Um commit técnico separado não significa autorização de deploy.

## Próximas ações sem impacto no ambiente atual

1. Inspecionar localmente referências remanescentes a `acceptAdultConsent` em código, workflows e documentação, incluindo arquivos não rastreados; documentar possíveis consumidores do cliente atual.
2. Verificar por canais autorizados o endpoint implantado e telemetria de uso, **sem modificar** Functions, credenciais ou dados do projeto. Se indisponível, registrar como desconhecido; não inferir zero chamadas.
3. Executar testes E2E e visual apenas em projeto `demo` isolado, sem afetar emuladores/sessões de desenvolvimento existentes.
4. Verificar todos os caminhos alternativos de Auth e a barreira para recursos adultos; não equiparar UID criado a admissão completa.
5. Registrar uma proposta explícita de corte ou compatibilidade, com owner, data e plano de reversão. Não remover o endpoint por pressuposto.
