// functions/src/community/search-community-members-page.handler.ts
// -----------------------------------------------------------------------------
// SEARCH COMMUNITY MEMBERS PAGE
// -----------------------------------------------------------------------------
// Busca paginada de integrantes por nickname público. O índice apenas localiza
// candidatos; autorização, membership, maioridade pública e bloqueios bilaterais
// são revalidados antes de qualquer item ser retornado.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { resolveBlockedTargetUids } from '../friendship/application/bilateral-block-access.policy';
import { normalizePublicProfileId } from '../identity/public-profile-id';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  buildCommunityMemberSearchIndexProjection,
  decodeCommunityMemberSearchCursor,
  encodeCommunityMemberSearchCursor,
  normalizeCommunityMemberSearchQuery,
} from './community-member-search-index.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { getCommunityViewerContext } from './community-viewer-access.service';

type CommunityMemberRole = 'owner' | 'admin' | 'moderator' | 'member';

interface SearchCommunityMembersPageRequest {
  communityId?: unknown;
  query?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface SearchCommunityMembersPageItem {
  memberKey: string;
  identity: {
    profileId: string;
    nickname: string;
    label: string;
    avatarUrl: string | null;
  };
  role: CommunityMemberRole;
}

interface SearchCommunityMembersPageResponse {
  items: SearchCommunityMembersPageItem[];
  nextCursor: string | null;
  memberCount: number;
  generatedAt: number;
}

const SAFE_MEMBER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 40;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A busca de integrantes ainda não está disponível neste ambiente.',
    { reason: 'community_search_unavailable' }
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!SAFE_MEMBER_ID_PATTERN.test(uid)) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.',
      { reason: 'email_verification_required' }
    );
  }

  return uid;
}

function normalizePageLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeRole(value: unknown): CommunityMemberRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

export const searchCommunityMembersPage =
  onCall<SearchCommunityMembersPageRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<SearchCommunityMembersPageResponse> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();

      const actorUid = assertAuthenticatedUid(request.auth);
      const communityId = normalizeCommunityId(request.data?.communityId);
      const query = normalizeCommunityMemberSearchQuery(request.data?.query);
      const providedCursor = String(request.data?.cursor ?? '').trim();
      const cursor = providedCursor
        ? decodeCommunityMemberSearchCursor(providedCursor)
        : null;
      const limit = normalizePageLimit(request.data?.limit);

      if (
        !communityId
        || !query
        || (providedCursor && !cursor)
        || (cursor && cursor.query !== query)
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Consulta de busca de integrantes inválida.',
          {
            reason: providedCursor
              ? 'community_search_cursor_invalid'
              : 'community_search_query_invalid',
          }
        );
      }

      const context = await getCommunityViewerContext(actorUid, communityId);
      if (
        context.community.source.type !== 'community'
        || !context.activeMembership
      ) {
        throw new HttpsError(
          'permission-denied',
          'A busca de integrantes é visível somente para participantes ativos.',
          { reason: 'community_search_membership_required' }
        );
      }

      await consumeCommunityRateLimit({
        action: 'member_search',
        actorUid,
      });

      const nowMs = Date.now();
      const scanLimit = Math.min(limit * 3 + 1, MAX_PAGE_LIMIT * 3 + 1);
      let indexQuery = db
        .collection('community_member_search_index')
        .where('communityId', '==', communityId)
        .where('searchPrefixes', 'array-contains', query)
        .orderBy('publicLabelNormalized', 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(scanLimit);

      if (cursor) {
        indexQuery = indexQuery.startAfter(
          cursor.publicLabelNormalized,
          cursor.documentId
        );
      }

      const indexSnapshot = await indexQuery.get();
      const candidateIds = indexSnapshot.docs
        .map((document) => String(document.data()?.['memberId'] ?? '').trim())
        .filter((memberId) => SAFE_MEMBER_ID_PATTERN.test(memberId));
      const blockedUids = await resolveBlockedTargetUids(actorUid, candidateIds);
      const visibleCandidateIds = candidateIds.filter(
        (memberId) => !blockedUids.has(memberId)
      );

      const [membershipSnapshots, profileSnapshots] =
        visibleCandidateIds.length > 0
          ? await Promise.all([
              db.getAll(
                ...visibleCandidateIds.map((memberId) =>
                  db
                    .collection('communities')
                    .doc(communityId)
                    .collection('members')
                    .doc(memberId)
                )
              ),
              db.getAll(
                ...visibleCandidateIds.map((memberId) =>
                  db.collection('public_profiles').doc(memberId)
                )
              ),
            ])
          : [[], []];

      const validationByMemberId = new Map(
        visibleCandidateIds.map((memberId, index) => [
          memberId,
          {
            membership: membershipSnapshots[index]?.exists
              ? membershipSnapshots[index].data() ?? null
              : null,
            profile: profileSnapshots[index]?.exists
              ? profileSnapshots[index].data() ?? null
              : null,
          },
        ])
      );

      const items: SearchCommunityMembersPageItem[] = [];
      let lastConsumedDocument:
        FirebaseFirestore.QueryDocumentSnapshot | null = null;

      for (const document of indexSnapshot.docs) {
        lastConsumedDocument = document;
        const memberId = String(document.data()?.['memberId'] ?? '').trim();
        if (!SAFE_MEMBER_ID_PATTERN.test(memberId) || blockedUids.has(memberId)) {
          continue;
        }

        const validation = validationByMemberId.get(memberId);
        if (!validation) continue;

        const projection = buildCommunityMemberSearchIndexProjection({
          communityId,
          memberId,
          rawMembership: validation.membership,
          rawPublicProfile: validation.profile,
          nowMs,
        });

        if (!projection || !projection.searchPrefixes.includes(query)) continue;

        const role = normalizeRole(
          (validation.membership as Record<string, unknown> | null)?.['role']
        );
        const profile = (validation.profile ?? {}) as Record<string, unknown>;
        const profileId = normalizePublicProfileId(profile['profileId']);
        const nickname = normalizeText(profile['nickname'], 60);

        if (!role || !profileId || profileId !== projection.profileId) continue;

        items.push({
          memberKey: profileId,
          identity: {
            profileId,
            nickname,
            label: nickname,
            avatarUrl: normalizeHttpsUrl(
              profile['avatarUrl'] ?? profile['photoURL']
            ),
          },
          role,
        });

        if (items.length >= limit) break;
      }

      const lastConsumedIndex = lastConsumedDocument
        ? indexSnapshot.docs.findIndex(
            (document) => document.id === lastConsumedDocument?.id
          )
        : -1;
      const hasBufferedDocuments =
        lastConsumedIndex >= 0
        && lastConsumedIndex < indexSnapshot.docs.length - 1;
      const mayHaveAnotherPage =
        indexSnapshot.docs.length === scanLimit || hasBufferedDocuments;
      const nextCursor =
        mayHaveAnotherPage && lastConsumedDocument
          ? encodeCommunityMemberSearchCursor({
              query,
              publicLabelNormalized: String(
                lastConsumedDocument.data()?.['publicLabelNormalized'] ?? ''
              ),
              documentId: lastConsumedDocument.id,
            })
          : null;

      return {
        items,
        nextCursor,
        memberCount:
          context.capacity?.memberCount
          ?? context.community.metrics.memberCount,
        generatedAt: nowMs,
      };
    }
  );
