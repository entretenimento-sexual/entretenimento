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

## EST-R1.2.2.4 — consolidação da fonte canônica

Base: 1db8a9d9. Community Mural Visual Validation 45640248974
interrompeu build:safe em ui-section-hierarchy: o seletor local
.community-management-hub__nav button duplicava o contrato compartilhado.

Removido o bloco local integralmente. cards.css mantém a regra dimensional
administrativa de 44px em ambos os eixos (ou token maior) e passa a definir
flex-shrink: 0 para os botões da navegação segmentada da gestão. O CSS local
conserva somente o layout e o overflow horizontal do contêiner.

Verificação estática dirigida: nenhum dos seletores proibidos pelo bloco
communityMembershipManagementCss da auditoria permanece no CSS editado;
regra de 44px e overflow preservados. Auditoria e asserções visuais não
foram alteradas. Execução integral de build:safe, Quality Gate e testes
visuais depende da nova CI.
