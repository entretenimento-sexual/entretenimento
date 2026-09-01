// functions/src/community/official-communities.query.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITIES PUBLIC QUERY
// -----------------------------------------------------------------------------
// Única leitura backend para superfícies que precisam listar Comunidades
// oficialmente vinculadas a uma entidade canônica. A consulta usa somente a
// projeção pública sanitizada do discovery; associação privada/auditoria jamais
// são retornadas ao cliente.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import type { CommunityOfficialTarget } from './community-official-association.model';
import {
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';

export async function loadOfficialCommunitiesForTarget(
  target: Readonly<CommunityOfficialTarget>,
  limit: number
): Promise<CommunityDiscoveryPageResponse> {
  const scanLimit = Math.min(Math.max(Math.trunc(limit), 1) * 3, 36);
  const projectionSnapshot = await db
    .collection('community_discovery_index')
    .where('officialAssociation.target.type', '==', target.type)
    .where('officialAssociation.target.id', '==', target.id)
    .limit(scanLimit)
    .get();

  const items = projectionSnapshot.docs
    .map((document) =>
      sanitizeCommunityDiscoveryProjection(document.id, document.data())
    )
    .filter((item): item is CommunityPreviewCard => {
      const official = item?.officialAssociation;
      return !!item
        && official?.verified === true
        && official.target.type === target.type
        && official.target.id === target.id;
    })
    .sort((left, right) => {
      const memberDelta = right.metrics.memberCount - left.metrics.memberCount;
      return memberDelta || left.name.localeCompare(right.name, 'pt-BR');
    })
    .slice(0, limit);

  return {
    items,
    nextCursor: null,
    generatedAt: Date.now(),
  };
}
