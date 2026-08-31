// functions/src/community/community-discovery-ranking-mode.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING MODE SERVICE
// -----------------------------------------------------------------------------
// Cache curto por instância para evitar duas leituras extras do Firestore a cada
// página de descoberta. O fallback continua sempre conservador para `legacy`.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import {
  type CommunityDiscoveryRankingModeDecision,
  resolveCommunityDiscoveryRankingMode,
} from './community-discovery-ranking-mode.policy';

const CACHE_TTL_MS = 30_000;

let cachedDecision: CommunityDiscoveryRankingModeDecision | null = null;
let cachedAt = 0;
let pendingDecision: Promise<CommunityDiscoveryRankingModeDecision> | null = null;

async function loadCommunityDiscoveryRankingMode():
  Promise<CommunityDiscoveryRankingModeDecision> {
  const [configSnapshot, runtimeSnapshot] = await Promise.all([
    db.collection('platform_config').doc('community').get(),
    db.collection('community_ranking_runtime').doc('daily').get(),
  ]);

  return resolveCommunityDiscoveryRankingMode(
    configSnapshot.exists ? configSnapshot.data() : null,
    runtimeSnapshot.exists ? runtimeSnapshot.data() : null
  );
}

export async function getCommunityDiscoveryRankingMode():
  Promise<CommunityDiscoveryRankingModeDecision> {
  const now = Date.now();

  if (cachedDecision && now - cachedAt < CACHE_TTL_MS) {
    return cachedDecision;
  }

  if (!pendingDecision) {
    pendingDecision = loadCommunityDiscoveryRankingMode()
      .then((decision) => {
        cachedDecision = decision;
        cachedAt = Date.now();
        return decision;
      })
      .finally(() => {
        pendingDecision = null;
      });
  }

  return pendingDecision;
}
