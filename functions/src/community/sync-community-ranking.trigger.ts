// functions/src/community/sync-community-ranking.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY DISCOVERY RANKING
// -----------------------------------------------------------------------------
// Mantém o score orgânico derivado sem acoplar cada callable ao ranking.
// Mudanças na Comunidade atualizam atividade/frescor/segurança; mudanças visuais
// na projeção atualizam qualidade. `rankScore` legado não é alterado aqui.
// O candidato v3 permanece shadow-only; o log compara ambos para diagnóstico.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityRankingProjectionPatch,
  haveCommunityRankingVisualInputsChanged,
  isCommunityRankingProjectionCurrent,
  isCommunityRankingSupportedDocument,
} from './community-ranking-sync.policy';

async function persistCommunityRanking(
  communityId: string,
  rawCommunity: unknown,
  rawDiscovery?: unknown
): Promise<void> {
  if (!isCommunityRankingSupportedDocument(rawCommunity)) return;

  const discoveryRef = db
    .collection('community_discovery_index')
    .doc(communityId);
  const discoverySnapshot = rawDiscovery === undefined
    ? await discoveryRef.get()
    : null;
  const discovery = rawDiscovery === undefined
    ? discoverySnapshot?.exists
      ? discoverySnapshot.data() ?? null
      : null
    : rawDiscovery;

  if (!discovery) return;

  const expected = buildCommunityRankingProjectionPatch(
    rawCommunity,
    discovery,
    Date.now()
  );

  if (isCommunityRankingProjectionCurrent(discovery, expected)) return;

  await discoveryRef.set(expected, { merge: true });

  logger.debug('community_discovery_ranking_synced', {
    communityId,
    discoveryScore: expected.discoveryScore,
    scoreVersion: expected.ranking.scoreVersion,
    candidateDiscoveryScore: expected.rankingCandidate.discoveryScore,
    candidateScoreVersion: expected.rankingCandidate.scoreVersion,
    candidateActivityScore: expected.rankingCandidate.activityScore,
    candidateActivityDelta: expected.rankingCandidate.activityDelta,
  });
}

export const syncCommunityRankingFromCommunity = onDocumentWritten(
  {
    document: 'communities/{communityId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId || !event.data?.after.exists) return;

    await persistCommunityRanking(
      communityId,
      event.data.after.data()
    );
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

    const communitySnapshot = await db
      .collection('communities')
      .doc(communityId)
      .get();

    if (!communitySnapshot.exists) return;

    await persistCommunityRanking(
      communityId,
      communitySnapshot.data(),
      after
    );
  }
);
