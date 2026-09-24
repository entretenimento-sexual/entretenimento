// functions/src/community/community-topics-product-state.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPICS PRODUCT STATE
// -----------------------------------------------------------------------------
// Tópicos/Discussões não fazem parte da navegação canônica de Comunidades.
// O produto adotou o Mural + comentários/respostas como superfície de conversa.
//
// O código e os dados legados permanecem preservados para eventual decisão futura,
// mas nenhuma callable de Tópicos pode servir leitura, escrita ou moderação enquanto
// este estado estiver "frozen". Reativação exige uma decisão explícita de produto,
// remoção consciente deste gate e atualização dos contratos arquiteturais.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export const COMMUNITY_TOPICS_PRODUCT_STATE = 'frozen' as const;

export function assertCommunityTopicsProductAvailable(): void {
  throw new HttpsError(
    'failed-precondition',
    'Discussões estão desativadas. Use o Mural da Comunidade.',
    {
      reason: 'community_topics_product_frozen',
      recommendedAction: 'use_community_mural',
      productState: COMMUNITY_TOPICS_PRODUCT_STATE,
    }
  );
}
