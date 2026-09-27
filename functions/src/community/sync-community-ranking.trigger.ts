// functions/src/community/sync-community-ranking.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY DISCOVERY RANKING
// -----------------------------------------------------------------------------
// Mantém o score orgânico derivado sem acoplar cada callable ao ranking.
// Mudanças na Comunidade atualizam atividade/frescor/segurança; mudanças visuais
// na projeção atualizam qualidade. `rankScore` legado não é alterado aqui.
// O candidato v3 permanece shadow-only; o log compara ambos para diagnóstico.
//
// Eventos são apenas sinais de recomputação: antes de qualquer persistência,
// Comunidade e discovery são relidas do estado canônico atual. Estados terminais
// removem a projeção e eventos atrasados nunca podem recriá-la.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildProductCalibrationRuntimeObservation,
} from '../shared/observability/product-calibration-observation.policy';
import {
  buildCommunityRankingProjectionPatch,
  haveCommunityRankingCommunityInputsChanged,
  haveCommunityRankingVisualInputsChanged,
  isCommunityRankingProjectionCurrent,
  isCommunityRankingSupportedDocument,
} from './community-ranking-sync.policy';

function isCommunityRankingTerminal(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  return community['status'] === 'archived'
    || community['status'] === 'scheduled_for_deletion';
}

async function persistCommunityRanking(
  communityId: string
): Promise<number> {
  const communityRef = db.collection('communities').doc(communityId);
  const discoveryRef = db
    .collection('community_discovery_index')
    .doc(communityId);
  const [communitySnapshot, discoverySnapshot] = await Promise.all([
    communityRef.get(),
    discoveryRef.get(),
  ]);

  if (!communitySnapshot.exists) {
    await discoveryRef.delete();
    return 1;
  }

  const community = communitySnapshot.data() ?? {};

  if (isCommunityRankingTerminal(community)) {
    await discoveryRef.delete();
    return 1;
  }

  if (!isCommunityRankingSupportedDocument(community)) return 0;
  if (!discoverySnapshot.exists) return 0;

  const discovery = discoverySnapshot.data() ?? {};
  const expected = buildCommunityRankingProjectionPatch(
    community,
    discovery,
    Date.now()
  );

  if (isCommunityRankingProjectionCurrent(discovery, expected)) return 0;

  await discoveryRef.set(expected, { merge: true });

  logger.debug('community_discovery_ranking_synced', {
    communityId,
    discoveryScore: expected.discoveryScore,
    scoreVersion: expected.ranking.scoreVersion,
    candidateDiscoveryScore: expected.rankingCandidate.discoveryScore,
    candidateScoreVersion: expected.rankingCandidate.scoreVersion,
    candidateActivityMomentumModelVersion:
      expected.rankingCandidate.activityMomentumModelVersion,
    candidateActivityScore: expected.rankingCandidate.activityScore,
    candidateActivityDelta: expected.rankingCandidate.activityDelta,
  });
  return 1;
}

export const syncCommunityRankingFromCommunity = onDocumentWritten(
  {
    document: 'communities/{communityId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId || !event.data?.after.exists) return;

    const before = event.data.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data.after.data();

    if (!haveCommunityRankingCommunityInputsChanged(before, after)) return;

    const derivedWrites = await persistCommunityRanking(communityId);
    logger.debug('community_ranking_fanout_observed', {
      communityId,
      calibrationObservation: buildProductCalibrationRuntimeObservation({
        metric: 'community.projection.derived_writes_per_source_event',
        value: derivedWrites,
        source: 'community_ranking_from_community',
      }),
    });
  }
);

export const syncCommunityRankingFromDiscovery = onDocumentWritten(
  {
    document: 'community_discovery_index/{communityId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId || !event.data?.after.exists) return;

    const before = event.data.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data.after.data();

    if (!haveCommunityRankingVisualInputsChanged(before, after)) return;

    const derivedWrites = await persistCommunityRanking(communityId);
    logger.debug('community_ranking_fanout_observed', {
      communityId,
      calibrationObservation: buildProductCalibrationRuntimeObservation({
        metric: 'community.projection.derived_writes_per_source_event',
        value: derivedWrites,
        source: 'community_ranking_from_discovery',
      }),
    });
  }
);
