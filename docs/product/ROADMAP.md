# Roadmap de Produto

## Princípio de execução

O roadmap prioriza fundações seguras, ciclo social e retenção antes de monetização avançada. Cada fase deve entregar valor utilizável, possuir métricas, tratamento de erro, acessibilidade, responsividade e validação local.

## Estado atual

Concluído ou estabilizado:

- autenticação e recuperação de senha;
- verificação de e-mail;
- aceite de termos;
- conclusão de perfil;
- consentimento adulto;
- recuperação de conta sem documento;
- lifecycle de conta;
- proteção de campos sensíveis;
- compatibilidade básica entre gênero, orientação e preferências;
- publicação pública de fotos;
- visualização, reações, comentários e moderação de fotos;
- métricas públicas iniciais de mídia.

Pendência técnica transversal:

- reduzir o bundle inicial e eliminar o aviso de orçamento;
- executar suíte completa e smoke tests periodicamente.

## Fase 1 — Discovery V2

Objetivo: substituir leitura integral de perfis por feed paginado, personalizado e escalável.

Entregas:

- repositório paginado com cursor Firestore;
- chave de cache determinística;
- estado NgRx por consulta e página;
- stale-while-revalidate;
- modos `compatíveis`, `todos`, `disponíveis`, `próximos` e `profissionais`;
- exclusão de bloqueados, suspensos, invisíveis e contas incompletas;
- compatibilidade mútua;
- ranking por compatibilidade, disponibilidade, região, mídia, atividade e engagement;
- motivos de recomendação seguros;
- skeleton, vazio, erro, retry e fim da lista;
- preservação de scroll e estado;
- debug summary sem dados sensíveis.

Critério de conclusão:

- nenhuma tela principal carrega toda a coleção `public_profiles`;
- feed funciona em mobile com carregamento incremental;
- cenários de compatibilidade possuem cobertura automatizada.

## Fase 2 — Taxonomia de desejos

Objetivo: permitir desejos diversos sem poluir a interface ou expor preferências sensíveis.

Entregas:

- catálogo administrável de desejos;
- identificadores estáveis e aliases;
- categorias, sensibilidade e risco;
- níveis `INTERESTED`, `CURIOUS`, `EXPERIENCED`, `NOT_INTERESTED` e `HARD_LIMIT`;
- visibilidades `PRIVATE`, `MATCHES_ONLY`, `CONNECTIONS` e `PUBLIC`;
- opt-in mútuo para itens sensíveis;
- projeção pública mínima;
- filtros progressivos;
- busca e autocomplete;
- regras específicas para características protegidas;
- diferenciação entre desejo pessoal e tema profissional.

Critério de conclusão:

- nenhum limite ou preferência de alta sensibilidade é copiado para `public_profiles`;
- descoberta usa preferências sem revelar o motivo privado ao outro usuário.

## Fase 3 — Social Loop

Objetivo: transformar descoberta em conexão e conversa confiável.

Entregas:

- estados canônicos de relacionamento;
- solicitações idempotentes;
- aceitar, rejeitar, cancelar, desfazer e bloquear;
- ações consistentes em card, perfil e chat;
- atualização otimista com rollback;
- badges reativos;
- denúncias acessíveis;
- auditoria mínima;
- proteção contra spam e duplicidade.

Critério de conclusão:

- o usuário nunca vê uma ação incompatível com o estado real da relação;
- bloqueio interrompe descoberta, interação e mensagens.

## Fase 4 — Chat confiável

Objetivo: consolidar retenção por conversa.

Entregas:

- paginação por cursor;
- envio otimista;
- estados de envio;
- retry;
- não lidas consistentes;
- ordenação por atividade;
- cache NgRx;
- prevenção de listeners duplicados;
- integração com bloqueio e lifecycle;
- presença com privacidade;
- moderação de conteúdo e denúncia.

Critério de conclusão:

- mensagens de texto funcionam de forma estável antes de áudio, chamada ou recursos avançados.

## Fase 5 — Métricas confiáveis de mídia

Objetivo: garantir que visualizações, espectadores únicos, reações e score representem eventos reais.

Entregas:

- separar impressão, abertura e visualização contabilizada;
- separar espectadores únicos por mídia e por perfil;
- deduplicação por janela de tempo;
- origem do evento;
- antifraude básico;
- score centralizado no backend;
- métricas públicas limitadas;
- painel privado do criador;
- backfill dos agregados existentes.

Critério de conclusão:

- a mesma pessoa não aumenta múltiplas vezes o contador de espectadores únicos do perfil ao abrir várias mídias.

## Fase 6 — Vídeos públicos

Objetivo: oferecer vídeo com o mesmo nível de segurança das fotos.

Entregas:

- upload validado;
- limites de tamanho e duração;
- processamento assíncrono;
- thumbnail;
- estados de processamento;
- moderação;
- publicação;
- viewer responsivo;
- views, reações e comentários;
- Storage protegido;
- remoção e expurgo seguros;
- suporte a mídia valorizada preparado, mas não ativado antes dos entitlements.

## Fase 7 — Perfis profissionais

Objetivo: habilitar criadores e profissionais sem transformar a rede em catálogo.

Entregas:

- tipo de perfil profissional;
- verificação;
- identidade civil privada;
- selo público;
- categorias de conteúdo;
- métricas avançadas;
- gestão de audiência;
- ferramentas de publicação;
- controles de privacidade;
- onboarding financeiro separado;
- descoberta filtrável por `pessoas`, `profissionais` ou `todos`.

## Fase 8 — Mimos

Objetivo: permitir agrados voluntários com baixo atrito e segurança financeira.

Entregas:

- contas conectadas;
- limites de valor;
- histórico;
- idempotência;
- auditoria;
- antifraude;
- chargeback;
- feedback discreto;
- mimo em perfil, mídia e conversa quando permitido;
- nenhuma concessão de entitlement.

## Fase 9 — Mídia valorizada

Objetivo: permitir desbloqueio de conteúdo específico.

Entregas:

- preço e moeda;
- preview protegido;
- checkout;
- webhook como fonte de verdade;
- entitlement;
- acesso por backend;
- política de duração;
- estorno e revogação;
- ledger;
- taxa configurável da plataforma;
- painel do criador;
- proteção contra compartilhamento indevido.

## Fase 10 — Assinaturas de criadores

Objetivo: oferecer acesso recorrente a benefícios e coleções.

Entregas:

- planos do criador;
- cobrança recorrente;
- entitlement por período;
- cancelamento;
- renovação;
- past due;
- coleção exclusiva;
- métricas;
- repasses;
- taxa da plataforma.

## Fase 11 — Performance e expansão mobile

Trilha contínua, com marco específico após o ciclo social:

- reduzir bundle inicial;
- melhorar Core Web Vitals;
- otimizar imagens e vídeos;
- cache offline controlado;
- PWA;
- notificações push;
- navegação por gestos quando acessível;
- suporte a APK por estratégia compatível com Angular;
- testes em telas pequenas, tablets, desktop, paisagem e alto contraste.

## Regras de priorização

Uma entrega sobe de prioridade quando:

- corrige risco de segurança;
- desbloqueia o ciclo descoberta → conexão → conversa;
- reduz custo operacional;
- melhora retenção;
- prepara monetização sem dívida crítica;
- remove duplicidade estrutural;
- melhora mobile e acessibilidade.

Uma entrega não deve avançar quando:

- depende de escrita sensível pelo cliente;
- expõe preferência privada;
- usa leitura integral sem necessidade;
- duplica domínio existente;
- mistura pagamento com consentimento;
- introduz monetização sem entitlement ou auditoria;
- resolve problema apenas com CSS ou paliativo local.
