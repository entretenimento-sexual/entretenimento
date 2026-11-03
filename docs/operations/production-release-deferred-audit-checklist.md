# Memento — auditoria Firestore e cutover de nickname para o deploy de produção

> **Status em 03/11/2026: ADIADO POR CUSTO / NÃO EXECUTAR AGORA.**
> Documento de pré-deploy, **não** autorização de execução. A decisão do
> proprietário é desenvolver normalmente, sem habilitar logs de Data Access
> pagos apenas para iniciar antecipadamente a certificação de 30 dias.
> Revisar este documento no planejamento do futuro lançamento.

## Onde se aplica

| Ambiente | Projeto Firebase | Situação verificada em 03/11/2026 |
| --- | --- | --- |
| Desenvolvimento | Firebase Emulator (`dev-emu`) | Testes locais; não servem como certificação LIVE |
| Homologação | `entretenimento-staging` | Hierarquia IAM sem pais; pré-diagnóstico retornou `DATA_WRITE=false`, retenção de 30 dias e nenhuma amostra |
| Produção | `entretenimento-sexual` | Hierarquia IAM sem pais; pré-diagnóstico retornou `DATA_WRITE=false`, retenção de 30 dias e nenhuma amostra |

O usuário chegou a selecionar **Firestore/Datastore API → Gravação de dados**
no Console de homologação, **sem comprovação de que tenha salvado**.
A intenção registrada depois foi **não ativar a auditoria agora**, por
causa de custos na fase de desenvolvimento. Não presumir o estado atual do
Console: repetir o diagnóstico antes de qualquer decisão.

## Pendências para o futuro pré-deploy

- [ ] **Autorizar o gasto:** avaliar custos e volume esperado dos registros
  `DATA_WRITE`, retenção acima de 30 dias e eventual exportação. Registrar
  responsável, orçamento, alertas e decisão sobre o que efetivamente será ativado.
- [ ] **Verificar o projeto de destino:** confirmar pelo ID, não pelo apelido.
  Nunca misturar `entretenimento-staging` e `entretenimento-sexual`; validar
  credenciais e acessos mínimos, sem publicar relatórios ou tokens.
- [ ] **Preparar em homologação:** após aprovação específica, habilitar
  somente `DATA_WRITE` para o serviço IAM `datastore.googleapis.com`
  (Firestore/Datastore API). Não habilitar `DATA_READ`,
  `allServices` ou isenções indiscriminadas.
- [ ] **Revisar Cloud Logging:** sinks, filtros, políticas IAM locais/herdadas,
  bucket de destino, acesso a logs privados, prazo de retenção mínimo de
  **31 dias** se mantida a política de certificação e possibilidade de cobrança.
- [ ] **Comprovar cobertura real de gravações:** executar testes controlados,
  em ambiente autorizado, de escritas permitidas e negadas por Security
  Rules; verificar que ambos os tipos aparecem na fonte usada. Não assumir
  que uma resposta de consulta vazia prova ausência de tentativas.
- [ ] **Comprovar atribuição de clientes e caminhos:** garantir identificação
  confiável de versões antigas e dos caminhos de conclusão de cadastro e
  índices de nickname, inclusive escritas negadas, sem registrar UID, e-mail,
  IP, nickname, JWT ou payload em relatórios de certificação.
- [ ] **Revisar a migração de nickname:** inventário LIVE integral
  (`truncated=false`), dry-run de índices, compatibilidade dos clientes,
  Cloud Functions e App Check, elegibilidade etária, aceite, cadastro email/
  social, privacidade de `public_index`, Rules candidatas, testes E2E e
  estratégia de reversão — conforme o runbook canônico abaixo.
- [ ] **Registrar D0 apenas depois das provas:** obter revisão e aprovação
  de segurança/operação; documentar o D0 não retroativo e monitorar
  **720 horas UTC consecutivas** (30 dias) com cobertura e atribuição
  comprovadas, sem lacunas ou tentativas legadas/desconhecidas. O prazo
  ainda não começou. Se a regra de 30 dias for reavaliada antes do
  lançamento, essa mudança exigirá decisão expressa e atualização dos testes;
  nunca inventar dias de observação.
- [ ] **Deliberar o GO/NO-GO:** relatório do avaliador pode indicar
  `REVIEW_READY`, mas não autoriza deploy; a decisão final precisa ser
  humana, documentada e específica para o ambiente.

## Ferramentas de consulta (somente leitura)

```powershell
# Substituir pelo projeto a ser avaliado, após autorização operacional.
$env:FIREBASE_PROJECT_ID = 'entretenimento-staging'
node .\scripts\maintenance\check-nickname-firestore-logging-readonly.mjs
npm run nickname:audit-inheritance-readonly
```

Para o projeto principal, usar explicitamente
`$env:FIREBASE_PROJECT_ID = 'entretenimento-sexual'` e repetir a leitura
antes de planejar qualquer mudança. Essas ferramentas **não ativam logs**,
não alteram Rules e não certificam D0 por conta própria.

**Referência técnica canônica:** [Runbook de cutover de nickname](./registration-nickname-cutover-runbook.md).
Os relatórios e atestados reais devem permanecer fora do Git. Nunca incluir
segredos, tokens, dados pessoais ou extratos de logs no repositório.

**Revisão no futuro:** na abertura do plano de deploy, atualizar as caixas
e anexar apenas referências internas às evidências. Não interpretar a
ausência de evidência como aprovação.
