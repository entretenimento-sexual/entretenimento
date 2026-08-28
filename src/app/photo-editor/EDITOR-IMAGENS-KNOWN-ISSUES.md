# Pendências conhecidas — editor de imagens
20ABR2026

## Status
A integração atual com o editor de imagens é provisória e não deve ser tratada como solução definitiva da plataforma.

## Problema observado
Há histórico de erro residual do software terceirizado de edição, inclusive em cenários fora da abertura manual do editor.

### Sintomas já observados
- `Cannot read properties of undefined (reading 'width')`
- falhas anteriores passando por `PinturaEditorComponent.initEditor`
- erro aparecendo já na rota da galeria privada `/media/perfil/:id/fotos`

## Decisão atual
- não travar a evolução do produto por causa deste editor
- manter upload, galeria privada, publicação pública e exibição a terceiros desacoplados da solução final de edição
- tratar o editor atual como substituível

## Diretrizes
- evitar import estático do editor em componentes de tela, shell e header
- preferir lazy loading / import dinâmico
- não espalhar contratos do fornecedor de edição pelo domínio de mídia
- reavaliar a integração quando o editor definitivo for escolhido

## Observação
Se novos erros surgirem, registrar stack, rota e fluxo exato antes de investir em nova rodada de correções profundas.