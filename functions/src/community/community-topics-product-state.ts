// functions/src/community/community-topics-product-state.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPICS PRODUCT STATE
// -----------------------------------------------------------------------------
// Tópicos/Discussões não fazem parte da navegação canônica de Comunidades.
// O Mural + comentários/respostas é a superfície canônica de conversa.
//
// Código e dados legados permanecem preservados apenas para compatibilidade e
// eventual saneamento. Nenhuma callable de Tópicos pode servir leitura, escrita
// ou moderação enquanto este domínio estiver congelado.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export const COMMUNITY_TOPICS_PRODUCT_STATE = 'frozen' as const;

export function assertCommunityTopicsProductAvailable(): void {
  throw new HttpsError(
    'failed-precondition',
    'Discussões estão desativadas. Use o Mural da Comunidade.',
    {
      reason: 'community_topics_product_frozen',
      productState: COMMUNITY_TOPICS_PRODUCT_STATE,
    }
  );
}
