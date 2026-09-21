// src/app/community/discovery/community-boost-display.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST DISPLAY POLICY
// -----------------------------------------------------------------------------
// Política puramente visual. Não participa do ranking orgânico.
//
// O slot patrocinado:
// - só existe quando há inventário orgânico suficiente;
// - aparece depois dos três primeiros cards orgânicos;
// - não cria slots adicionais quando a paginação é expandida;
// - não roda automaticamente enquanto o usuário permanece na mesma página.
// -----------------------------------------------------------------------------

export const COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_SLOT = 4;
export const COMMUNITY_BOOST_ORGANIC_CARDS_BEFORE_SLOT = 3;

export function resolveCommunityBoostInsertionAfterIndex(
  organicCardCountValue: unknown
): number | null {
  const organicCardCount = Math.max(
    0,
    Math.trunc(Number(organicCardCountValue) || 0)
  );

  if (organicCardCount < COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_SLOT) {
    return null;
  }

  return Math.min(
    COMMUNITY_BOOST_ORGANIC_CARDS_BEFORE_SLOT,
    organicCardCount
  ) - 1;
}
