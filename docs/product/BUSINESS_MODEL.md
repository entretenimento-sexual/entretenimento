# Modelo de Negócio

## Objetivo

Definir como a plataforma gera receita e como usuários podem receber valores sem misturar interação social, conteúdo, serviços, consentimento e pagamento.

## Perfis e papéis econômicos

### Usuário pessoal

Pode descobrir pessoas, conectar, conversar, publicar conteúdo, enviar mimos, desbloquear mídia e assinar perfis ou benefícios.

### Casal

Pode operar como perfil social conjunto, publicar conteúdo e utilizar os mesmos recursos econômicos, respeitando verificação e titularidade financeira.

### Perfil profissional ou criador verificado

Pode receber mimos, publicar conteúdo valorizado, oferecer assinatura de conteúdo, impulsionar mídia e acessar métricas avançadas.

A verificação profissional não autoriza exposição pública do nome civil e não representa consentimento para contato sexual ou encontro.

## Fontes de receita da plataforma

- planos da própria plataforma;
- recursos premium de descoberta;
- impulsionamento de perfil;
- impulsionamento de mídia;
- ferramentas profissionais;
- analytics avançado;
- comissão sobre desbloqueio de conteúdo, quando aprovada;
- comissão sobre assinatura de criadores, quando aprovada;
- recursos de destaque e distribuição.

A plataforma pode optar por não reter percentual de mimos, mantendo receita em outras frentes.

## Mimos

Mimo é um agrado financeiro voluntário.

Regras:

- não compra conteúdo;
- não cria direito de acesso;
- não gera obrigação de resposta;
- não representa consentimento;
- não garante encontro;
- não permite insistência;
- deve possuir limites mínimos e máximos;
- deve ter histórico e auditoria;
- deve respeitar chargeback, fraude e compliance do provedor.

A preferência atual é repasse direto por infraestrutura equivalente a contas conectadas, sem retenção da plataforma, sujeito a validação do provedor e dos custos operacionais.

## Mídia valorizada

Mídia valorizada é um desbloqueio comercial de foto ou vídeo específico.

Requisitos:

- preço informado antes da compra;
- preview protegido;
- entitlement registrado no backend;
- acesso condicionado ao entitlement;
- proteção contra URL direta;
- política clara de duração do acesso;
- histórico de compra;
- tratamento de estorno;
- auditoria;
- possibilidade de taxa da plataforma;
- moderação obrigatória antes da oferta.

O desbloqueio não transfere direitos autorais nem autoriza redistribuição.

## Assinaturas de criadores

Assinatura concede acesso recorrente a um conjunto definido de benefícios enquanto estiver ativa.

Pode incluir:

- conteúdo exclusivo;
- prioridade de distribuição;
- selo de apoiador;
- acesso a coleções;
- recursos sociais diferenciados.

Não pode incluir promessa de encontro, contato sexual ou obrigação de atendimento pessoal.

## Planos da plataforma

Os planos da plataforma podem oferecer:

- filtros avançados;
- maior alcance;
- maior quantidade de mídia;
- recursos de privacidade;
- analytics;
- impulsionamentos incluídos;
- ferramentas profissionais;
- gestão de audiência;
- benefícios em salas ou comunidades futuras.

Recursos essenciais de segurança, bloqueio, denúncia e privacidade básica não devem depender de pagamento.

### Business / Official — capacidade orientada por dados reais

Business/Official não deve nascer de uma estimativa antecipada de preço, quantidade de Comunidades ou capacidade de membros.

A plataforma deve separar três conceitos:

- **autoridade oficial**: comprova que a pessoa pode representar Perfil, Organização, Local ou Evento;
- **entitlement comercial**: define a capacidade contratada daquele cliente/organização;
- **role comunitária**: owner/admin/mod/member governa a Comunidade, sem provar representação comercial.

A oferta Business/Official só deve ser recalibrada depois de uma janela operacional real de produção qualificada (mínimo atual de 14 dias) e de uma janela observada da oferta real contendo, no mínimo:

- quantidade de ofertas apresentadas;
- conversões efetivas;
- quantidade de Comunidades efetivamente criadas pelos clientes convertidos;
- custo financeiro realizado, obtido de billing/finanças.

Proxies técnicos de Firestore, Functions, push ou Storage servem para orçamento operacional, mas não podem ser convertidos em `actualCostCents` nem usados como se fossem custo financeiro realizado.

Os limites globais de Official existentes no runtime são **hard ceilings técnicos de segurança**, não preço, pacote nem recomendação comercial. Grants/entitlements Business/Official devem carregar explicitamente a quantidade contratada e a capacidade de membros dentro desses tetos. Mudanças posteriores de oferta devem ser versionadas e justificadas pelos dados observados, sem alterar score orgânico ou autoridade oficial.

As policies executáveis que validam a sequência são:

- baseline operacional: `functions/src/shared/observability/operational-cost-baseline.policy.ts`;
- calibração Business/Official: `functions/src/community/community-business-official-calibration.policy.ts`.

A calibração falha fechado quando o custo não vier de billing/finanças ou quando o baseline operacional ainda não estiver pronto.

## Impulsionamento

Impulsionamento é distribuição patrocinada de perfil ou mídia.

Requisitos:

- identificação clara de conteúdo impulsionado;
- elegibilidade e moderação prévia;
- limites de frequência;
- não superar bloqueios ou preferências do usuário;
- não exibir perfil incompatível apenas porque pagou;
- métricas transparentes para o comprador;
- proteção contra fraude de impressões e views.

### Community Boost — custo orientado por dados reais

O preço patrocinado não deve ser recalibrado a partir do score orgânico, de estimativa de Firestore ou de um único período de tráfego. Antes de analisar custo do Boost, a plataforma exige:

- baseline operacional real de produção qualificado;
- placements efetivamente servidos;
- custo financeiro realizado atribuído ao domínio patrocinado, vindo de Cloud Billing export ou alocação financeira;
- manutenção da separação entre cobrança patrocinada e ranking orgânico.

A policy de análise é `functions/src/community-boost/community-boost-cost-calibration.policy.ts`. Ela calcula custo real por mil placements apenas para análise; não altera automaticamente CPM, orçamento mínimo/máximo nem configuração comercial ativa.

## Desejos e monetização

A taxonomia de desejos serve para descoberta e conteúdo, mas não deve produzir categorias comerciais ofensivas ou objetificação pública de características protegidas.

A plataforma deve diferenciar:

- desejo pessoal;
- tema de conteúdo profissional;
- limite;
- preferência privada;
- categoria de mídia.

Um profissional publicar conteúdo sobre determinado tema não significa disponibilidade pessoal para praticá-lo.

## Segurança financeira

- identidade financeira fora do perfil público;
- onboarding de recebimento separado do cadastro social;
- idempotência em cobranças e repasses;
- webhook como fonte de verdade;
- nenhuma liberação baseada apenas no retorno do navegador;
- ledger interno auditável;
- segregação entre saldo, repasse e entitlement;
- tratamento de chargeback;
- limites antifraude;
- retenções e bloqueios quando exigidos;
- logs sem exposição de dados bancários.

## Consentimento e pagamento

Nenhum pagamento concede:

- consentimento sexual;
- direito de contato fora da plataforma;
- direito de insistência;
- direito a encontro;
- acesso à identidade real;
- autorização para gravação, reprodução ou redistribuição;
- permissão para ignorar bloqueio ou denúncia.

## Métricas de negócio

Métricas principais:

- ativação do cadastro;
- perfis elegíveis para descoberta;
- taxa de conexão;
- conversas iniciadas;
- retenção por coorte;
- publicação de mídia;
- taxa de visualização;
- conversão de mídia valorizada;
- mimos enviados;
- assinaturas ativas;
- receita líquida;
- chargeback;
- denúncias por mil interações;
- tempo de resposta da moderação.

Métricas nunca devem incentivar exposição insegura, spam ou incompatibilidade.

## Decisões ainda abertas

- percentual da plataforma em mídia valorizada;
- percentual em assinaturas de criadores;
- provedor final para conteúdo adulto;
- duração do entitlement de compra unitária;
- limites de preço;
- política de reembolso;
- tratamento de contas não resgatadas;
- países e moedas iniciais;
- eventual entrada de estabelecimentos parceiros.
