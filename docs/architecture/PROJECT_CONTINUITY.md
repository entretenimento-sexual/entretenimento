# Continuidade do projeto Entretenimento

> Documento canônico para preservar contexto, decisões e raciocínio entre chats.
>
> Deve ser lido antes de propor ou implementar qualquer alteração relevante nesta branch.

## Como usar este documento

Ao iniciar um novo chat ou retomar o projeto:

1. ler este arquivo por completo;
2. confirmar a branch atual e comparar o HEAD com o último commit validado indicado abaixo;
3. inspecionar os arquivos realmente existentes na branch, sem depender apenas do histórico da conversa;
4. tratar decisões registradas como restrições arquiteturais, não como sugestões descartáveis;
5. registrar aqui toda mudança de direção, supressão, risco aceito ou novo bloco validado.

Novas ideias são bem-vindas, mas não devem substituir decisões anteriores silenciosamente. Quando houver proposta melhor, registrar:

- o problema identificado;
- a decisão anterior afetada;
- a nova alternativa;
- os benefícios;
- os riscos e a estratégia de migração.

## Repositório e fluxo de trabalho

- Repositório: `entretenimento-sexual/entretenimento`
- Branch de trabalho: `feat/auth-password-recovery-polish`
- Não criar branches adicionais, PRs, merges ou deploys sem solicitação explícita.
- Alterações devem ser pequenas, coesas e separadas por domínio.
- Mudanças visuais, infraestrutura, segurança e produto não devem ser misturadas sem necessidade técnica real.
- Preservar nomenclaturas públicas de métodos quando houver consumidores existentes.
- Não substituir arquivos extensos integralmente quando uma alteração localizada for suficiente.
- Toda supressão ou ocultação de código existente deve ser declarada com o motivo.

## Manifesto permanente

### Interface

- Mobile-first, preparada para futuras compilações nativas.
- Responsividade fluida de smartphones a telas grandes, em retrato e paisagem.
- Visual clean, minimalista, discreto e profissional.
- Evitar títulos, subtítulos e descrições que repitam a mesma informação.
- Conteúdo e ação principal devem ter prioridade sobre decoração.
- Ícones devem ser globais, consistentes e funcionais, nunca apenas ruído visual.
- Links globais devem ser reduzidos por hierarquia de menus e submenus.
- Ações específicas devem aparecer no contexto em que são necessárias.
- Suporte refinado a light, dark, alto contraste, foco visível e movimento reduzido.
- Não criar botões desabilitados sem função, placeholders promocionais ou controles falsos.

### Angular

- Priorizar APIs modernas e nativas do Angular.
- Preferir Observables, reatividade, `OnPush`, carregamento lazy e signals quando apropriado.
- Evitar subscriptions imperativas escondidas.
- Manter feedback robusto para o usuário e diagnóstico técnico para desenvolvimento.
- Erros devem continuar centralizados em `global-error-handler.service.ts` e `error-notification.service.ts`.
- Usar NgRx e cache quando houver ganho arquitetural real, sem duplicar estado local simples.

### Firebase e segurança

- O frontend nunca concede autorização, entitlement, papel ou acesso financeiro.
- Rules e Cloud Functions são a autoridade.
- Conteúdo sensível deve falhar fechado.
- Projeções de descoberta e dados derivados devem ser backend-only quando houver risco de enumeração.
- Localização pública deve ser aproximada; coordenadas precisas e presença individual não devem ser expostas.
- Escritas relevantes devem passar por comandos de backend, com validação, auditoria e idempotência.
- Nenhuma mídia comunitária deve ser publicada sem autoria interna, moderação, visibilidade e possibilidade de denúncia.

### Monetização

- Políticas de acesso devem ser independentes do gateway de pagamento.
- A aplicação trabalha com entitlement, nível mínimo e validade, não com dados do processador.
- Planos previstos: `basic`, `premium` e `vip`.
- Conteúdo pode exigir assinatura ativa, papel, perfil concluído, elegibilidade adulta ou compra específica.
- A confirmação financeira ocorre no backend.
- A interface deve encaminhar para a área canônica de planos e preservar `returnUrl` seguro.

## Modelo de produto consolidado

### Locais e salas

Locais e salas possuem autoridade própria, mas compartilham uma camada social de comunidade.

- `venue`: comunidade oficial de estabelecimento ou ponto moderado.
- `room`: comunidade associada a uma sala.
- Sala privada de participantes não é automaticamente a sala oficial de um estabelecimento.
- Não usar vínculo singular `venue.chat.roomId` como fonte de verdade.

Uma comunidade pode oferecer:

- mural/feed;
- fotos e vídeos;
- membros e moderadores;
- informações essenciais;
- chat contextual;
- conteúdo público, de membros ou de assinantes.

### Visitante e integrante

Visitante autenticado pode acompanhar a prévia pública aprovada, mas não pode:

- publicar;
- comentar;
- reagir;
- enviar mídia;
- entrar no chat;
- consultar membros privados;
- acessar presença exata.

Membro ativo pode interagir quando a comunidade estiver operacional e sua política permitir.

Papéis previstos:

- `owner`;
- `admin`;
- `moderator`;
- `member`.

Estados de membership:

- `active`;
- `pending`;
- `blocked`;
- `left`.

Comunidade pausada pode continuar visível para membro ativo, mas sem interação.

## Estado técnico consolidado

### Base integralmente validada

Último commit conhecido como integralmente validado:

`1f05b2c3f733270aef66dcf631a6cabc392778b6`

Resultado dessa validação:

- Angular: 165 arquivos e 545 testes aprovados;
- Functions: 60 testes aprovados;
- Rules: 8 arquivos e 63 testes aprovados;
- `FINAL total: 0`;
- `build:safe`, `build:emu` e `build:staging` aprovados;
- bundle inicial de produção: 2,64 MB;
- aviso não bloqueante: 39,76 kB acima do orçamento de 2,60 MB;
- avisos `punycode` permanecem não bloqueantes.

### Implementações presentes na branch depois da base validada

A branch contém trabalho posterior ao commit acima. Antes de afirmar que ele está concluído, validar o HEAD atual.

Foram identificados na branch:

- modelo e política canônica de comunidades;
- descoberta paginada por projeção backend-only;
- página comunitária lazy e protegida por flag;
- prévia pública somente leitura;
- mural e galeria comunitários somente leitura;
- repositórios Angular baseados em Observable e `defer`;
- política de solicitação de membership;
- política de acesso ao feed;
- callable paginada para o feed comunitário;
- testes de frontend, Functions e Rules relacionados;
- seed fictício e idempotente para o emulador.

Essas implementações posteriores não devem ser declaradas como validadas sem executar novamente as suítes no HEAD atual.

## Decisões arquiteturais vigentes

### Comunidade como camada social comum

`venues` e `rooms` não serão fundidos em uma mesma coleção. A comunidade referencia a origem por:

- `source.type: venue | room`;
- `source.id`.

Feed, mídia, membership e políticas sociais usam o domínio comunitário compartilhado.

### Descoberta sem enumeração direta

- `communities` não permite `list` pelo cliente.
- `community_discovery_index` é backend-only.
- A descoberta usa callable paginada e resposta sanitizada.
- A página de detalhe usa callable que lê somente a comunidade e o membership do próprio usuário.

### Conteúdo projetado não pode inicializar antes da autorização

Evitar wrappers genéricos com `ng-content` para conteúdo protegido. O padrão é ramificação estrutural:

```html
@if (decision.allowed) {
  <app-protected-content />
} @else {
  <app-content-access-notice />
}
```

### Assinatura autoritativa

- Não confiar em `monthlyPayer`, `isSubscriber` ou projeções legadas como autoridade financeira.
- Entitlement determinístico deve validar UID, escopo, papel, `startsAt` e `endsAt`.
- Campos financeiros legados continuam protegidos nas Rules.

### Escrita comunitária

- Criação, adesão, aprovação, mudança de papel, moderação e escrita de conteúdo não devem ser feitas diretamente pelo navegador.
- Usar Functions transacionais, idempotentes e auditáveis.
- Cliente lê apenas dados sanitizados e o próprio vínculo quando autorizado.

## Próximas prioridades

Ordem de trabalho preferencial:

1. validar integralmente o HEAD atual;
2. fechar o fluxo de solicitar entrada, entrada aberta e estado pendente;
3. implementar saída voluntária e aprovação por moderador;
4. implementar publicação comunitária via Function, começando por texto e foto;
5. adicionar moderação, denúncia e auditoria da mídia comunitária;
6. integrar locais e salas reais ao domínio comunitário;
7. implementar check-in com privacidade e localização aproximada;
8. consolidar a navegação principal em poucos pais e submenus contextuais;
9. ativar interação somente depois de backend, Rules e testes estarem completos;
10. tratar o excesso do bundle inicial em bloco técnico separado.

## Pontos ainda não concluídos

- Não há autorização para deploy de produção.
- Ainda existem componentes placeholder de salas que precisam de migração ou retirada controlada.
- `CommunityService` legado não deve ser usado como base da nova arquitetura sem migração.
- Feed e galeria comunitários ainda precisam de fluxo completo de escrita, moderação e denúncia.
- Locais reais, salas oficiais e check-ins ainda não estão operacionalizados de ponta a ponta.
- Consolidação definitiva de sidebar, bottom navigation e submenus ainda não foi feita.
- Conteúdo pago comunitário ainda precisa de integração completa com entitlement e retorno pós-pagamento.

## Operação local

Se `emu:discovery:start` informar portas ocupadas, os emuladores já estão em execução. Não iniciar uma segunda instância e não executar `emu:pre` automaticamente.

Procedimento seguro:

1. verificar o terminal que iniciou os emuladores;
2. reutilizar a instância existente;
3. executar apenas o seed necessário em outro terminal;
4. iniciar o Angular com `npm.cmd run start:emu`;
5. encerrar os emuladores com `Ctrl+C` no terminal original para preservar o export.

O comando `emu:pre` só deve ser usado conscientemente quando os dados locais puderem ser interrompidos.

## Validação padrão antes de declarar um bloco concluído

```powershell
cd C:\entretenimento

git restore firestore.rules
git pull --ff-only

npm.cmd run test:ci
npm.cmd --prefix functions test
npm.cmd run test:rules
npm.cmd run build:safe
npm.cmd run build:emu
npm.cmd run build:staging

git restore firestore.rules
git status --short
```

Não anunciar totais esperados antes de confirmar os testes realmente adicionados ao HEAD atual.

## Protocolo de atualização deste arquivo

Após cada bloco aceito:

- atualizar o último commit validado;
- registrar totais reais de testes e builds;
- mover itens concluídos para o estado técnico;
- registrar decisões novas e seus motivos;
- declarar supressões e migrações;
- atualizar riscos e próxima prioridade;
- não apagar decisões antigas sem explicar a substituição.

## Instrução curta para um novo chat

Use esta mensagem ao retomar o projeto:

> Leia `docs/architecture/PROJECT_CONTINUITY.md` na branch `feat/auth-password-recovery-polish`, confira o HEAD atual e compare-o com o último commit validado. Preserve as decisões registradas, proponha melhorias sem reinterpretar silenciosamente o produto e continue apenas pelo próximo bloco coeso.