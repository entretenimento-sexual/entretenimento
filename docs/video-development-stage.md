# Estado atual do pipeline de vídeos

## Classificação

A plataforma permanece em **desenvolvimento local e validação automatizada**.

O repositório, os pull requests empilhados e os workflows de staging não constituem autorização para:

- implantar a aplicação em produção;
- disponibilizar a plataforma para usuários reais;
- configurar credenciais de produção;
- executar migrações sobre dados reais;
- habilitar monetização;
- executar o smoke test contra serviços reais;
- integrar a pilha de PRs em `main` sem revisão individual.

## Significado de `video-staging`

`video-staging` é somente um contrato técnico preservado para uma homologação futura e isolada do pipeline de vídeos.

Ele documenta como validar, quando a plataforma estiver madura:

```text
App Check
  -> reserva de quota
  -> Storage Rules
  -> registro do upload
  -> Cloud Tasks
  -> Google Transcoder
  -> publicação
  -> observabilidade
  -> limpeza dos dados sintéticos
```

O workflow real permanece:

- manual;
- inativo sem GitHub Environment, OIDC, IAM, secrets e variables;
- proibido para o projeto `entretenimento-sexual`;
- limitado ao projeto isolado `entretenimento-staging`;
- sem capacidade de deploy.

## Fase autorizada

Neste momento estão autorizados apenas:

1. desenvolvimento local;
2. Firebase Emulators;
3. testes unitários, de integração e de Rules;
4. builds de verificação;
5. auditoria estática de contratos;
6. revisão arquitetural e de segurança;
7. pull requests em rascunho;
8. correções incrementais sem promoção de ambiente.

## Fase não autorizada

Permanecem suspensos até decisão explícita futura:

1. deploy de Functions, Rules, índices, Hosting ou aplicativo;
2. execução do `Video Staging Smoke`;
3. criação de secrets para o smoke;
4. concessão de IAM à service account de homologação;
5. ativação de faturamento motivada apenas pelo smoke;
6. uso de dados ou contas reais;
7. merge da pilha #68–#73 em `main`.

## Critérios mínimos antes de homologação real

A futura homologação somente deve ser considerada após coerência comprovada dos fluxos de:

- conta e ciclo de vida;
- idade e reverificação;
- privacidade e audiência;
- bloqueios nos dois sentidos;
- compatibilidade entre perfis;
- publicação e visualização;
- moderação e denúncias;
- exclusão e retenção;
- recuperação de falhas;
- segurança das URLs de mídia;
- navegação mobile e acessibilidade;
- custos, quotas e observabilidade.

## Próxima prioridade técnica

O próximo lote deve tratar a política centralizada de acesso e audiência dos vídeos, reutilizada por perfil, viewer, chat e futura descoberta.

Essa política deve impedir que a entrega de metadados ou URLs assinadas dependa apenas do cliente ou de projeções públicas, considerando:

- proprietário e administrador;
- autenticação;
- maioridade e reverificação;
- estado da conta;
- publicação, processamento e moderação;
- visibilidade;
- bloqueio em ambos os sentidos;
- amizade, assinatura, associação e compatibilidade;
- conteúdo removido, suspenso ou rejeitado.

## Terminologia

Nos documentos e PRs atuais:

- **homologação futura** significa procedimento técnico ainda não autorizado;
- **staging** significa projeto isolado sem usuários reais;
- **deploy** aparece apenas como descrição da sequência que poderá ser usada no futuro;
- **produção** significa ambiente real e permanece fora do escopo atual.

Nenhum procedimento futuro deve ser executado por inferência. É necessária autorização explícita para configurar infraestrutura, secrets, IAM, staging real ou produção.
