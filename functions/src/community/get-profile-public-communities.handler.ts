// functions/src/community/get-profile-public-communities.handler.ts
// -----------------------------------------------------------------------------
// GET PROFILE PUBLIC COMMUNITIES
// -----------------------------------------------------------------------------
// Lista somente participações explicitamente publicadas pelo titular do perfil.
// O índice privado localiza candidatos; autorização vem sempre do membership
// canônico e da policy da Comunidade. O card é lido exclusivamente de
// `community_discovery_index`, evitando duplicação de dados públicos.
// -----------------------------------------------------------------------------

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { normalizePublicProfileId } from '../identity/public-profile-id';
import { assertNoActiveBilateralBlock } from '../friendship/application/bilateral-block-access.policy';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  collectCommunityMyPageIncrementally,
} from './community-my-page-scan.policy';
import {
  resolveCommunityMembershipVisibility,
} from './community-membership-visibility.policy';
import {
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  filterCommunityDiscoveryCardForViewer,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

interface ProfilePublicCommunitiesRequest {
  profileId?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

function assertRuntime(): void {
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
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  return uid;
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 12) : 4;
}

const SAFE_PROFILE_COMMUNITY_CURSOR_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_PROFILE_COMMUNITY_CURSOR_PATTERN.test(normalized)
    ? normalized
    : null;
}

function timestampToMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function isCurrentPublicProfileForCommunityDisclosure(
  profile: Record<string, unknown> | null | undefined,
  nowMs: number
): boolean {
  if (!profile || profile['ageEligibilityVerifiedAdult'] !== true) {
    return false;
  }

  const validUntilMs = timestampToMillis(
    profile['ageEligibilityValidUntil']
  );

  return validUntilMs !== null && validUntilMs > nowMs;
}

export const getProfilePublicCommunities = onCall<ProfilePublicCommunitiesRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityDiscoveryPageResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertRuntime();
    const viewerUid = assertAuthenticatedUid(request.auth);
    await assertCommunitySocialAccessForUid(viewerUid);
    const nowMs = Date.now();

    const profileId = normalizePublicProfileId(request.data?.profileId);
    const limit = normalizeLimit(request.data?.limit);
    const providedCursor = String(request.data?.cursor ?? '').trim();
    const cursor = normalizeCursor(request.data?.cursor);

    if (providedCursor && !cursor) {
      throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
    }

    if (!profileId) {
      throw new HttpsError('invalid-argument', 'Perfil inválido.');
    }

    // A identidade pública é a única entrada do cliente. O UID é resolvido
    // exclusivamente no backend e precisa ser único para evitar composição
    // entre dados de perfis diferentes.
    const publicProfilesSnapshot = await db
      .collection('public_profiles')
      .where('profileId', '==', profileId)
      .limit(2)
      .get();

    if (publicProfilesSnapshot.size > 1) {
      throw new HttpsError(
        'data-loss',
        'A identidade pública do perfil está inconsistente.',
        { reason: 'public_profile_identity_duplicate' }
      );
    }

    const publicProfileSnapshot = publicProfilesSnapshot.docs[0];
    if (!publicProfileSnapshot) {
      return { items: [], nextCursor: null, generatedAt: nowMs };
    }

    const publicProfile =
      publicProfileSnapshot.data() as Record<string, unknown>;
    if (
      !isCurrentPublicProfileForCommunityDisclosure(
        publicProfile,
        nowMs
      )
    ) {
      return { items: [], nextCursor: null, generatedAt: nowMs };
    }

    const profileUid = String(publicProfileSnapshot.id ?? '').trim();
    if (!profileUid || profileUid.length > 128 || profileUid.includes('/')) {
      throw new HttpsError(
        'data-loss',
        'A identidade pública do perfil está inconsistente.',
        { reason: 'public_profile_identity_invalid' }
      );
    }

    await assertNoActiveBilateralBlock(
      viewerUid,
      profileUid,
      'Perfil indisponível.'
    );

    const indexCollection = db
      .collection('community_profile_membership_index')
      .doc(profileUid)
      .collection('items');
    const initialCursorSnapshot = cursor
      ? await indexCollection.doc(cursor).get()
      : null;

    if (cursor && !initialCursorSnapshot?.exists) {
      throw new HttpsError(
        'invalid-argument',
        'Cursor de paginação não encontrado.'
      );
    }

    const result = await collectCommunityMyPageIncrementally<
      QueryDocumentSnapshot,
      CommunityPreviewCard
    >({
      limit,
      loadBatch: async (afterDocument, batchLimit) => {
        let query = indexCollection.orderBy('updatedAt', 'desc').limit(batchLimit);
        const pageCursor = afterDocument ?? initialCursorSnapshot;
        if (pageCursor) query = query.startAfter(pageCursor);
        return (await query.get()).docs;
      },
      validateDocuments: async (documents) => {
        if (documents.length === 0) return [];

        const canonicalRefs = documents.flatMap((document) => {
          const communityRef = db.collection('communities').doc(document.id);
          const targetMembershipRef = communityRef.collection('members').doc(profileUid);
          return viewerUid === profileUid
            ? [communityRef, targetMembershipRef]
            : [
              communityRef,
              targetMembershipRef,
              communityRef.collection('members').doc(viewerUid),
            ];
        });
        const canonicalSnapshots = await db.getAll(...canonicalRefs);
        const eligible: Array<{
          index: number;
          communityId: string;
          viewerMembership: unknown;
        }> = [];
        let offset = 0;

        for (let index = 0; index < documents.length; index += 1) {
          const document = documents[index];
          if (!document) continue;

          const communitySnapshot = canonicalSnapshots[offset++];
          const targetMembershipSnapshot = canonicalSnapshots[offset++];
          const viewerMembershipSnapshot = viewerUid === profileUid
            ? targetMembershipSnapshot
            : canonicalSnapshots[offset++];
          const community = communitySnapshot?.exists
            ? communitySnapshot.data()
            : null;
          const targetMembership = targetMembershipSnapshot?.exists
            ? targetMembershipSnapshot.data()
            : null;

          if (
            resolveCommunityMembershipVisibility(
              community,
              targetMembership
            ).visible
          ) {
            eligible.push({
              index,
              communityId: document.id,
              viewerMembership: viewerMembershipSnapshot?.exists
                ? viewerMembershipSnapshot.data()
                : null,
            });
          }
        }

        const output: Array<CommunityPreviewCard | null> =
          documents.map(() => null);
        if (eligible.length === 0) return output;

        const projectionSnapshots = await db.getAll(
          ...eligible.map(({ communityId }) =>
            db.collection('community_discovery_index').doc(communityId)
          )
        );

        for (let index = 0; index < eligible.length; index += 1) {
          const candidate = eligible[index];
          const projectionSnapshot = projectionSnapshots[index];
          if (!candidate || !projectionSnapshot) continue;

          const card = projectionSnapshot.exists
            ? sanitizeCommunityDiscoveryProjection(
              candidate.communityId,
              projectionSnapshot.data()
            )
            : null;
          const visibleCard = card?.source.type === 'community'
            ? filterCommunityDiscoveryCardForViewer(
              card,
              candidate.viewerMembership
            )
            : null;
          output[candidate.index] = visibleCard;
        }

        return output;
      },
    });

    return {
      items: [...result.items],
      nextCursor: result.mayHaveAnotherPage
        ? (result.lastConsumedDocument?.id ?? null)
        : null,
      generatedAt: nowMs,
    };
  }
);
