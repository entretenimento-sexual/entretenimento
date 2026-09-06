// functions/src/community/community-ranking-shadow-readiness.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING SHADOW READINESS
// -----------------------------------------------------------------------------
// Decide se a comparação shadow v2 x v3 pode ser executada. O runtime autoritativo
// pode continuar pronto durante um backfill shadow-only; por isso a comparação
// exige também a versão de momentum concluída, nunca apenas a versão em execução.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
} from './community-ranking-candidate-v3.policy';

export type CommunityRankingShadowUnavailableReason =
  | 'ranking_cycle_not_ready'
  | 'candidate_activity_momentum_migration_in_progress';

export interface CommunityRankingShadowReadiness {
  available: boolean;
  unavailableReason: CommunityRankingShadowUnavailableReason | null;
}

export function resolveCommunityRankingShadowReadiness(input: {
  runtimeReadyForTarget: boolean;
  completedCandidateActivityMomentumModelVersion: unknown;
}): CommunityRankingShadowReadiness {
  if (!input.runtimeReadyForTarget) {
    return {
      available: false,
      unavailableReason: 'ranking_cycle_not_ready',
    };
  }

  if (
    Number(input.completedCandidateActivityMomentumModelVersion)
      !== COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION
  ) {
    return {
      available: false,
      unavailableReason: 'candidate_activity_momentum_migration_in_progress',
    };
  }

  return {
    available: true,
    unavailableReason: null,
  };
}
