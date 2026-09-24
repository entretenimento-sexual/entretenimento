// functions/src/community/get-my-community-activity-cards.handler.ts
// -----------------------------------------------------------------------------
// GET MY COMMUNITY ACTIVITY CARDS
// -----------------------------------------------------------------------------
// Resolve somente os poucos cards necessários para o bloco de atividade do
// Explore. Os IDs candidatos vêm do resumo agregado de unread, mas cada card é
// revalidado em lote contra Comunidade + membership canônicos antes de sair.
// Isso evita carregar a primeira página inteira de "Minhas comunidades" apenas
// para materializar até três atalhos de atividade.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  type CommunityDiscoveryPageResponse,
  type CommunityPreviewCard,
  normalizeCommunityId,
  resolveCommunityViewerMode,
  sanitizeCommunityDocument,
} from './community-preview.model';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

interface MyCommunityActivityCardsRequest {
  readonly communityIds?: unknown;
}

const MAX_ACTIVITY_CANDIDATES = 6;

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

function normalizeCandidateIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();

  for (const rawId of value) {
    const communityId = normalizeCommunityId(rawId);
    if (!communityId) continue;

    ids.add(communityId);
    if (ids.size >= MAX_ACTIVITY_CANDIDATES) break;
  }

  return [...ids];
}

export const getMyCommunityActivityCards =
  onCall<MyCommunityActivityCardsRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityDiscoveryPageResponse> => {
      const startedAt = Date.now();
      assertCommunityCallableAppCheck(request.app);
      assertPreviewRuntime();
      const uid = assertAuthenticatedUid(request.auth);
      await assertCommunitySocialAccessForUid(uid);

      const communityIds = normalizeCandidateIds(request.data?.communityIds);
      if (communityIds.length === 0) {
        return {
          items: [],
          nextCursor: null,
          generatedAt: Date.now(),
        };
      }

      const communityRefs = communityIds.map((communityId) =>
        db.collection('communities').doc(communityId)
      );
      const membershipRefs = communityRefs.map((communityRef) =>
        communityRef.collection('members').doc(uid)
      );
      const snapshots = await db.getAll(...communityRefs, ...membershipRefs);
      const communitySnapshots = snapshots.slice(0, communityIds.length);
      const membershipSnapshots = snapshots.slice(communityIds.length);
      const items: CommunityPreviewCard[] = [];

      for (let index = 0; index < communityIds.length; index += 1) {
        const communitySnapshot = communitySnapshots[index];
        const membershipSnapshot = membershipSnapshots[index];

        if (
          !communitySnapshot?.exists
          || !membershipSnapshot?.exists
          || communitySnapshot.data()?.['status'] !== 'active'
        ) {
          continue;
        }

        const viewer = resolveCommunityViewerMode(membershipSnapshot.data());
        if (!viewer.active || !viewer.role) continue;

        const card = sanitizeCommunityDocument(
          communitySnapshot.id,
          communitySnapshot.data()
        );
        if (!card || card.source.type !== 'community') continue;

        items.push({
          ...card,
          viewerRole: viewer.role,
        });
      }

      logger.info('community_activity_cards_served', {
        requestedCandidates: communityIds.length,
        canonicalReads: communityIds.length * 2,
        returned: items.length,
        durationMs: Date.now() - startedAt,
      });

      return {
        items,
        nextCursor: null,
        generatedAt: Date.now(),
      };
    }
  );
