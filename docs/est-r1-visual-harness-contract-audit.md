# EST-R1.2.2.5 — auditoria transversal dos ambientes visuais

Base 99109a08. Foram verificados os sete workflows visuais e o Quality Gate.
Community Page, Community Discovery, Discovery, Preferences e Registration
passaram. Mural falhou em TS2353 (replyCount não integra mais o DTO de comentário).
Explore falhou em TS2551/TS2339 nas três configurações, por membros ausentes
do shell visual e do CurrentUserStoreService substituto. O Quality Gate
falhou em um teste arquitetural (3302/3303 testes Angular aprovados):
cards.css não pode referenciar hosts Angular específicos.

Correções:
- Mural e Community Page usam os contratos públicos tipados dos repositórios
  (Pick com keyof), sem APIs de replies legadas; projeção de contagem usa
  o mesmo repositório de feed. Citações replyTo permanecem.
- Explore: a fixture autenticada e hidratada não representa perfil ausente
  e não inicia logout; os dois métodos requeridos refletem essas condições.
  Não há mudança de guards, autenticação ou registro de produção.
- CSS: opt-in semântico app-admin-controls nos sete componentes; 44px em
  ambos os eixos, flex-shrink:0 na navegação segmentada. Sem dependência de
  seletores Angular no stylesheet compartilhado. Teste arquitetural original
  preservado e novo teste verifica a adesão à classe.
- Os sete workflows incluem alterações de dependências e do contrato auth
  nos paths; os quatro ambientes de app completo também observam shell e
  registro. Nenhuma etapa/asserção removida, nenhuma configuração excluída.

A revisão é estática e baseada nos contratos/erros e resultados do SHA base;
a execução integral de cada configuração, console e screenshots permanece
necessária na nova CI. Nenhum rate limit ou regra Firestore foi modificado.
