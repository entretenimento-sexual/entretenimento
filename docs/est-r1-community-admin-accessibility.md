# EST-R1.2.2.3 — alvos de interação administrativos

Base: 8707cadb. O workflow Community Page Visual Validation 45637173018
reportou minTarget=40, sem overflow e com console aprovado.

## Auditoria estática

- cards.css: app-action usa control-height-sm/tap-target-sm (40px) e
  app-segmented__button usa 30px. Variáveis padrão de alvo: 44px.
- Histórico: atualizar já possui tamanho explícito pelo token; ações de
  paginação/retry herdam o estilo compacto. O log anterior não identificava
  nominalmente o controle de 40px.
- Gestão: navegação segmentada, solicitações, cards e ações dos módulos
  filhos compartilham os estilos compactos.
- Participantes e propriedade: limpar busca fixava width/height/min-* em
  2rem. Corrigido explicitamente.
- Reivindicação oficial: botão de retry fixava min-height em 2.5rem.
- Configurações e convites: ações de classes compartilhadas agora respeitam
  o mínimo administrativo. Avatares, ícones decorativos e inputs internos
  de checkbox não são alvos de ação independentes.

## Decisão

Aplicar limite mínimo de 44px (ou token maior) no escopo dos componentes
administrativos, sem inflar ações compactas de outros módulos. Preservar
a navegação horizontal interna, evitar encolhimento dos botões, manter
todos os controles, nomes acessíveis e eventos existentes. Nenhuma alteração
de autorização, chamadas, reatividade ou Rules.

## Evidência a validar

Asserções anteriores permanecem; a CI acrescenta inspeção dimensional de
controles visíveis da gestão desktop/mobile, das solicitações desktop e
diagnóstico por nome e dimensões no Histórico. A auditoria estática dos
outros painéis não substitui testes de navegador em cada estado real.
