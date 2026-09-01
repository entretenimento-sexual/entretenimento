// functions/src/community/community-discovery-ranking-mode.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING MODE SERVICE
// -----------------------------------------------------------------------------
// Cache curto por instância para evitar duas leituras extras do Firestore a cada
// página de descoberta. O fallback continua sempre conservador para `legacy`.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';

import { db } from '../firebaseApp';
import {
  type CommunityDiscoveryRankingModeDecision,
  resolveCommunityDiscoveryRankingMode,
} from './community-discovery-ranking-mode.policy';

const CACHE_TTL_MS = 30_000;

let cachedDecision: CommunityDiscoveryRankingModeDecision | null = null;
let cachedAt = 0;
let pendingDecision: Promise<CommunityDiscoveryRankingModeDecision> | null = null;
let lastDiagnosticKey: string | null = null;

function logDecisionChange(
  decision: Readonly<CommunityDiscoveryRankingModeDecision>
): void {
  const diagnosticKey = [
    decision.requestedMode,
    decision.effectiveMode,
    decision.targetMode,
    decision.fallbackReason ?? 'ready',
    decision.scoreVersion,
  ].join(':');

  if (diagnosticKey === lastDiagnosticKey) return;
  lastDiagnosticKey = diagnosticKey;

  if (
    decision.requestedMode !== 'legacy'
    && decision.effectiveMode === 'legacy'
  ) {
    logger.warn('community_discovery_ranking_fallback', {
      requestedMode: decision.requestedMode,
      targetMode: decision.targetMode,
      fallbackReason: decision.fallbackReason,
      scoreVersion: decision.scoreVersion,
    });
    return;
  }

  if (decision.effectiveMode !== 'legacy') {
    logger.info('community_discovery_ranking_score_enabled', {
      effectiveMode: decision.effectiveMode,
      scoreVersion: decision.scoreVersion,
    });
  }
}

async function loadCommunityDiscoveryRankingMode():
  Promise<CommunityDiscoveryRankingModeDecision> {
  try {
    const [configSnapshot, runtimeSnapshot] = await Promise.all([
      db.collection('platform_config').doc('community').get(),
      db.collection('community_ranking_runtime').doc('daily').get(),
    ]);
    const decision = resolveCommunityDiscoveryRankingMode(
      configSnapshot.exists ? configSnapshot.data() : null,
      runtimeSnapshot.exists ? runtimeSnapshot.data() : null
    );

    logDecisionChange(decision);
    return decision;
  } catch (error) {
    if (lastDiagnosticKey !== 'ranking-mode-read-error') {
      lastDiagnosticKey = 'ranking-mode-read-error';
      logger.warn('community_discovery_ranking_mode_read_failed', {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }

    return resolveCommunityDiscoveryRankingMode(null, null);
  }
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
