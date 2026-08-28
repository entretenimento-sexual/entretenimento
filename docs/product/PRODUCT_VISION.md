# Visão de Produto

## Propósito

Construir uma rede social adulta, segura, discreta e financeiramente sustentável para pessoas adultas, casais e perfis profissionais se descobrirem, interagirem, compartilharem conteúdo e criarem conexões com privacidade, consentimento e controle.

A plataforma combina descoberta social, compatibilidade, conteúdo adulto, presença, conversa e monetização sem transformar pessoas em produtos, pagamentos em consentimento ou o aplicativo em um catálogo vulgar.

## Posicionamento

A plataforma é uma rede social adulta baseada em:

- compatibilidade entre identidades, orientações, interesses e desejos;
- descoberta segura e personalizada;
- perfis pessoais, de casal e profissionais;
- fotos, vídeos e conteúdo valorizado;
- conversas e conexões sociais;
- privacidade e discrição por padrão;
- monetização integrada ao ciclo social.

Não é apenas aplicativo de encontros, diretório profissional, loja de mídia ou plataforma de assinaturas. Esses recursos existem dentro de uma experiência social coerente.

## Ciclo principal de valor

```text
descobrir
→ entender a compatibilidade
→ conhecer o perfil
→ interagir
→ conectar
→ conversar
→ acompanhar conteúdo
→ apoiar financeiramente, quando desejar
→ retornar por novas interações
```

## Tipos de perfil

### Perfil pessoal

Voltado a descoberta, desejos, amizade, encontros, relacionamento, conversa e consumo ou publicação de conteúdo.

### Perfil de casal

Identidade conjunta, composição configurável, orientações individuais quando aplicável e compatibilidade própria.

### Perfil profissional ou criador verificado

Perfil social com recursos adicionais de publicação, audiência, monetização, métricas, mimos, conteúdo valorizado e assinaturas.

A atividade profissional não significa consentimento para contato sexual, encontro, insistência ou exposição da identidade civil.

### Parceiros e estabelecimentos

Possível expansão futura, condicionada a validação jurídica, operacional e de produto. Não integra o núcleo atual.

## Princípios de experiência

- Mobile-first real.
- Navegação simples, intuitiva e consistente.
- Visual adulto, sofisticado e discreto.
- Interface limpa, sem excesso de textos, filtros ou blocos repetidos.
- Revelação progressiva de opções avançadas.
- Excelente adaptação a smartphones, tablets, desktops e telas grandes.
- Modos claro, escuro e alto contraste.
- Acessibilidade desde o componente, não como correção posterior.
- Feedback claro para loading, sucesso, vazio, erro e retry.
- Preservação de estado, scroll e contexto ao navegar.

## Descoberta

A descoberta deve considerar:

- gênero e orientação;
- interesses explícitos;
- desejos compartilhados;
- limites incompatíveis;
- distância e região aproximada;
- disponibilidade atual;
- atividade recente;
- qualidade do perfil;
- presença de mídia;
- sinais de engajamento confiáveis;
- bloqueios, denúncias e lifecycle da conta.

Compatibilidade deve ser mútua quando o contexto exigir. O usuário não deve receber explicações que revelem preferências privadas da outra pessoa.

## Desejos e preferências

Desejos sexuais diversos serão organizados por taxonomia administrável, sem listas enormes no perfil ou no menu principal.

Categorias principais:

- formatos de interação;
- práticas;
- fantasias;
- aparência e preferências físicas;
- estilo de vida;
- limites.

Cada preferência pode possuir:

- nível de interesse;
- visibilidade;
- sensibilidade;
- necessidade de opt-in mútuo;
- permissão ou proibição de exibição pública.

Características pessoais protegidas, como raça, etnia, deficiência ou condições físicas, não devem ser expostas como rótulos depreciativos ou motivos públicos de recomendação. Autodescrição é voluntária e preferências sensíveis ficam privadas.

## Mídia

Fotos e vídeos devem possuir ciclo completo:

- upload seguro;
- processamento;
- moderação;
- publicação;
- visibilidade;
- visualizações;
- reações;
- comentários;
- denúncias;
- score e ranking confiáveis;
- capa;
- conteúdo público, privado ou valorizado.

Métricas públicas devem ser limitadas ao necessário. Métricas detalhadas pertencem ao dono do conteúdo e à operação da plataforma.

## Segurança e privacidade

- Exclusivo para adultos.
- Menor exposição possível de dados pessoais.
- Pseudônimo público como padrão.
- Identidade civil e financeira isolada no backend e no provedor de pagamento.
- Nenhuma operação sensível confiada somente ao cliente.
- Consentimento explícito, versionado e auditável.
- Bloqueio e denúncia acessíveis.
- Lifecycle de conta centralizado no backend.
- Dados privados separados das projeções públicas.
- Conteúdo sensível protegido contra acesso por URL direta.
- Tratamento de erros centralizado.
- Debug útil sem vazamento de dados pessoais.

## Consentimento

Pagamento, mimo, assinatura, desbloqueio de mídia ou perfil profissional nunca significam:

- consentimento sexual;
- obrigação de resposta;
- garantia de encontro;
- direito de insistência;
- acesso à identidade civil;
- autorização para copiar ou redistribuir conteúdo;
- permissão para contornar bloqueios.

## Arquitetura de frontend

- Angular moderno.
- Observables como padrão para fluxos assíncronos.
- Signals onde forem adequados para estado local e derivado.
- NgRx para estados globais e domínios de alta complexidade.
- Cache com invalidação clara e stale-while-revalidate quando aplicável.
- Lazy loading e divisão de bundles.
- Componentes acessíveis e responsivos.
- Erros centralizados em `global-error-handler.service.ts` e `error-notification.service.ts`.

## Arquitetura de backend

- Firebase Auth para identidade.
- Firestore com separação entre dados privados e projeções públicas.
- Cloud Functions para ações sensíveis, monetização, métricas e auditoria.
- Storage com validação, processamento e controle de acesso.
- Regras deny-by-default.
- Operações idempotentes e transacionais quando necessário.

## Critério de decisão

Uma funcionalidade só deve ser incorporada quando melhorar ao menos um destes pontos sem degradar os demais:

- segurança;
- privacidade;
- interação;
- retenção;
- monetização;
- simplicidade;
- performance;
- acessibilidade;
- capacidade de expansão mobile.
