// functions/src/community/community-topics-product-state.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPICS PRODUCT STATE
// -----------------------------------------------------------------------------
// Discussões fazem parte da navegação canônica de Comunidades como uma superfície
// persistente complementar ao Mural. O Mural continua orientado a fluxo/tempo;
// Discussões organiza conversas por assunto para consulta e continuidade.
//
// As callables continuam obrigadas a passar por este contrato antes de qualquer
// acesso a dados. Assim uma eventual suspensão futura permanece centralizada sem
// espalhar feature flags ou condicionais pelo domínio.
// -----------------------------------------------------------------------------

export const COMMUNITY_TOPICS_PRODUCT_STATE = 'active' as const;

export function assertCommunityTopicsProductAvailable(): void {
  // Contrato intencionalmente explícito: o produto está ativo. A função permanece
  // como ponto canônico para uma eventual suspensão emergencial sem duplicar gates.
}
