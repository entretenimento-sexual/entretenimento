# Política operacional de KYC, verificação etária e PLD/FTP

## Objetivo

Aplicar controles proporcionais ao risco sem solicitar documentos ou reapresentar termos a todos os usuários indiscriminadamente.

Esta política diferencia três operações que não devem ser misturadas:

1. **aceite contratual**, relativo aos Termos de Uso e à ciência da Política de Privacidade;
2. **verificação etária**, necessária para acesso a conteúdo adulto;
3. **KYC financeiro e PLD/FTP**, aplicáveis principalmente a quem recebe valores, solicita saque ou apresenta risco financeiro relevante.

## Aceite contratual mínimo

O aceite obrigatório ocorre somente:

- no cadastro inicial;
- após alteração material dos documentos legais.

Não há novo aceite para:

- login comum;
- acesso recorrente a feed, chat ou mídia;
- correções editoriais sem efeito relevante;
- consulta voluntária dos documentos;
- abertura de caso de moderação ou conformidade.

Após o aceite, não é criada notificação de confirmação. O backend mantém a evidência auditável com usuário, data, versão e contexto. O aviso pendente da versão aceita é removido.

## Verificação etária

A simples caixa “sou maior de 18 anos” não deve ser tratada como verificação efetiva.

O desenho de produção deve usar provedor ou mecanismo confiável e armazenar apenas a evidência mínima necessária, por exemplo:

- status `18_PLUS_VERIFIED`;
- identificador opaco da verificação;
- método ou provedor;
- data da verificação;
- data de expiração, quando aplicável;
- versão da política utilizada.

A plataforma não deve armazenar cópia de documento ou data de nascimento completa quando um token ou sinal etário suficiente puder ser utilizado.

A experiência recomendada é:

- uma verificação antes do primeiro acesso adulto;
- validação silenciosa da credencial nos acessos seguintes;
- nova solicitação somente por expiração, mudança relevante de identidade, invalidação do provedor ou suspeita fundamentada;
- canal de contestação quando houver restrição por possível menoridade.

Enquanto não existir integração de produção com mecanismo confiável e não houver equipe operacional de revisão inicial, o onboarding usa **autodeclaração adulta provisória** como política de acesso. Essa decisão é registrada pelo backend como `DECLARED_ADULT` / `SELF_DECLARATION` e **não** pode ser apresentada, auditada ou tratada como `VERIFIED_ADULT`, KYC ou prova documental.

No modo inicial `DECLARATION_FIRST`:

- o usuário confirma explicitamente ter 18 anos ou mais;
- o backend registra a declaração e a trilha de auditoria;
- o consentimento adulto continua sendo uma etapa separada;
- o usuário não precisa aguardar revisão humana inexistente nem enviar documento sem um fluxo operacional real;
- denúncias de possível menoridade permanecem disponíveis, protegidas por App Check, rate limit, deduplicação e detecção de abuso;
- uma denúncia isolada não equivale a prova de menoridade nem deve produzir bloqueio permanente sem caminho de contestação;
- estados de segurança já fundamentados, conflito com provedor ou reverificação ativa não podem ser anulados por nova autodeclaração.

A arquitetura de prova forte permanece pronta. `VERIFIED_ADULT` continua reservado a assertion de provedor, KYC ou revisão baseada em evidência confiável. Quando um provedor etário for contratado e integrado, a política canônica pode migrar de `DECLARATION_FIRST` para `VERIFIED_ONLY` sem reutilizar a autodeclaração como prova.

O fallback operacional de revisão humana também não pode promover a autodeclaração por si só. Uma decisão `VERIFIED_ADULT` exige evidência confiável revisada por staff autorizado ou assertion equivalente. A aplicação recebe somente uma referência operacional da evidência e persiste apenas seu hash e o método da revisão; a referência bruta, documento, CPF, nome civil e data de nascimento não pertencem ao registro etário canônico.

## KYC financeiro proporcional

KYC financeiro não é exigido por padrão de quem apenas:

- cria perfil;
- navega;
- conversa;
- compra assinatura da própria plataforma.

O provedor de pagamento continua responsável por autenticação do pagador, antifraude e diligências adicionais acionadas por risco.

KYC completo é obrigatório antes de permitir que um usuário:

- receba gorjetas ou mimos;
- venda mídia ou live;
- receba assinatura de criador;
- configure conta de saque;
- receba o primeiro repasse.

Para pessoa física recebedora, o onboarding deve confirmar, por meio do provedor:

- identidade;
- CPF e dados cadastrais necessários;
- maioridade;
- titularidade ou validade da conta de pagamento;
- situação de PEP e sanções quando exigida pela política do provedor;
- resultado de risco e permissão para recebimento.

Para pessoa jurídica recebedora, também devem ser tratados:

- CNPJ;
- representantes autorizados;
- estrutura societária;
- beneficiário final, quando aplicável.

A plataforma deve armazenar preferencialmente status e identificadores opacos do provedor, não cópias desnecessárias dos documentos.

## Regras para habilitar monetização

Novos pagamentos a um criador somente podem ser aceitos quando todos os critérios estiverem satisfeitos:

- papel de criador habilitado;
- e-mail verificado;
- termos específicos de monetização aceitos;
- KYC com status `VERIFIED`;
- análise AML com status `CLEAR`;
- conta de pagamento com status `ACTIVE`;
- ausência de pausa operacional por falha de repasse.

O serviço `financial-compliance.policy.ts` contém a política canônica e seus testes.

## PLD/FTP e operações atípicas

A plataforma e o provedor devem manter controles compatíveis com seus respectivos papéis, incluindo:

- registros de checkout, evento financeiro e transação;
- verificação de assinatura de webhook;
- idempotência;
- conciliação;
- estorno e chargeback;
- identificação de volume ou comportamento atípico;
- restrição temporária durante análise;
- trilha de auditoria;
- preservação dos dados necessários pelo prazo aplicável.

Uma análise ou comunicação de operação suspeita não significa que o usuário praticou crime. O usuário não deve receber detalhes que revelem regras antifraude, critérios de seleção ou eventual comunicação às autoridades.

## Falha de saque

Conforme a decisão de produto:

- repasses são automáticos e periódicos;
- a plataforma não retém percentual da gorjeta destinada ao criador;
- o valor mínimo operacional inicialmente previsto é de R$ 100,00;
- falha persistente de repasse pausa novos pagamentos ao recebedor até regularização;
- a conta social pode continuar utilizável quando não houver outra restrição.

## Provedor e conteúdo adulto

Nenhuma monetização entre usuários deve ser habilitada antes de confirmar contratualmente que o provedor:

- aceita o modelo de conteúdo adulto da plataforma;
- oferece onboarding de contas recebedoras;
- executa KYC e controles PLD/FTP compatíveis;
- suporta repasses, estornos, chargebacks e bloqueios de risco;
- preserva a privacidade pública, mantendo nome civil e dados financeiros fora do perfil social.

O nickname permanece como identificação pública. A identidade real fica restrita à plataforma, ao provedor e às autoridades legalmente competentes.

## Estado atual do produto

O settlement atual permite somente `platform_subscription` e rejeita os escopos com recebedor até existir processador seguro habilitado.

Os escopos abaixo permanecem bloqueados para produção:

- `creator_subscription`;
- `tip`;
- `paid_media`;
- `paid_live`.

Essa restrição não deve ser removida apenas para liberar interface. A habilitação exige integração do provedor, persistência dos estados financeiros de conformidade, testes e revisão jurídica do enquadramento da empresa perante a Lei nº 9.613/1998 e o regulador aplicável.
