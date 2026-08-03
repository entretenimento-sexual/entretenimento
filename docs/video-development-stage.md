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
7. merge da pilha de vídeos em `main`.

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

## Política de audiência em desenvolvimento

O lote posterior ao contrato de staging centraliza a autorização de metadados e URLs de vídeos.

A decisão backend considera:

- autenticação e UID canônico;
- e-mail verificado do visitante;
- maioridade, consentimento, termos e reverificação;
- conta ativa do visitante e do autor;
- projeção pública e publicação privada equivalentes;
- publicação e moderação aprovadas;
- bloqueio em ambos os sentidos;
- amizade bilateral para audiência `FRIENDS`;
- negação por padrão para compatibilidade e entitlements do criador enquanto não houver fonte canônica integrada.

A consulta global direta por `collectionGroup('public_videos')` e a consulta direta da galeria de terceiros foram suprimidas. O motivo é estrutural: Firestore Rules não filtram dinamicamente autores bloqueados ou estados de lifecycle. As leituras passam por callables e continuam expostas ao Angular como Observables.

Interações, compartilhamento, chat, App Check e limitação de chamadas continuam em lotes separados. Eles não devem ser considerados protegidos apenas porque a listagem e a URL foram centralizadas.

## Editor básico de vídeos

A tela atual possui apenas:

- seleção e troca do arquivo;
- reprodução local;
- captura do quadro atual para capa;
- título e descrição;
- ativação de curtidas, comentários e avaliações;
- envio e publicação.

Isso não constitui um editor de vídeo.

Existe uma implementação experimental no PR #65 com:

- corte de início e fim;
- proporções Original, 9:16, 4:5 e 1:1;
- remoção de áudio;
- seleção de capa;
- receita de edição não destrutiva aplicada no Transcoder.

Essa implementação não foi integrada à cadeia atual, está em um PR paralelo e mistura alterações antigas de audiência, processamento e publicação. Portanto:

- não será feito merge ou retarget cego do PR #65;
- os arquivos do editor serão extraídos e adaptados sobre a arquitetura atual;
- o editor será um lote próprio após a segurança de audiência e interações;
- a transformação continuará no backend, sem FFmpeg/WASM pesado no navegador móvel;
- nenhuma ferramenta de edição é considerada implantada neste momento.

## Terminologia

Nos documentos e PRs atuais:

- **homologação futura** significa procedimento técnico ainda não autorizado;
- **staging** significa projeto isolado sem usuários reais;
- **deploy** aparece apenas como descrição da sequência que poderá ser usada no futuro;
- **produção** significa ambiente real e permanece fora do escopo atual.

Nenhum procedimento futuro deve ser executado por inferência. É necessária autorização explícita para configurar infraestrutura, secrets, IAM, staging real ou produção.
