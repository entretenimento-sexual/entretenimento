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

A simples confirmação “tenho 18 anos ou mais” **não é verificação efetiva**. No estágio inicial do produto, porém, ela é a base operacional provisória de admissão adulta enquanto não houver provedor etário contratado nem equipe de revisão dedicada.

O domínio distingue explicitamente os níveis de garantia:

- `SELF_DECLARED_ADULT`: autodeclaração 18+ registrada pelo backend, suficiente para o acesso inicial na política provisória;
- `VERIFIED_ADULT`: maioridade confirmada por fonte confiável, KYC, provedor ou revisão com evidência verificável;
- `REVIEW_REQUIRED` / `DENIED_UNDERAGE`: estados fortes de segurança que não podem ser sobrescritos por uma nova autodeclaração.

A autodeclaração nunca deve ser exibida, auditada ou projetada como “idade verificada”. O navegador também não escreve a autoridade etária diretamente: uma callable backend registra a declaração, sua versão de política e a trilha de auditoria.

Quando houver integração de produção com mecanismo confiável, o desenho deve armazenar apenas a evidência mínima necessária, por exemplo:

- status `VERIFIED_ADULT`;
- identificador opaco da verificação;
- método ou provedor;
- data da verificação;
- data de expiração, quando aplicável;
- versão da política utilizada.

A plataforma não deve armazenar cópia de documento ou data de nascimento completa quando um token ou sinal etário suficiente puder ser utilizado.

A evolução recomendada é:

- autodeclaração explícita 18+ no primeiro acesso durante a fase provisória;
- validação silenciosa de qualquer credencial confiável já existente;
- migração progressiva para provedor/KYC quando a integração estiver operacional;
- nova solicitação de verificação forte somente por política, expiração, mudança relevante de identidade ou sinal fundamentado de segurança;
- canal de contestação quando houver restrição por possível menoridade.

Denúncias de possível menoridade são registradas com deduplicação, rate limit e detecção de abuso. Uma denúncia isolada não suspende a conta. Volume crítico proveniente de denunciantes independentes pode produzir apenas uma limitação temporária e reversível; suspensão definitiva continua exigindo evidência confirmada.

O consentimento adulto permanece uma decisão separada e posterior à etapa etária. Ele não serve como prova de idade.

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
