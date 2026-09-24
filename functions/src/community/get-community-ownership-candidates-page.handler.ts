// functions/src/community/get-community-ownership-candidates-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY OWNERSHIP CANDIDATES PAGE
// -----------------------------------------------------------------------------
// Leitura backend-only e paginada dos membros que podem receber a propriedade.
// O cursor percorre memberships ativas em ordem de documentId; elegibilidade da
// conta continua sendo revalidada no servidor e nunca é inferida pelo navegador.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  assertCommunityMembershipActorEligible,
  assertCommunityMembershipActorEligibleForUid,
} from './community-membership-eligibility.service';
import {
  COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE,
} from './community-ownership-candidate-page.policy';
import {
  CommunityMemberManagementRoleFilter,
  decodeCommunityMemberManagementCursor,
  encodeCommunityMemberManagementCursor,
  matchesCommunityMemberManagementRoleFilter,
  normalizeCommunityMemberManagementCursorToken,
  normalizeCommunityMemberManagementRoleFilter,
  normalizeCommunityMemberManagementSearchQuery,
} from './community-member-management-index.policy';
import {
  CommunityOwnershipMembershipRole,
  CommunityOwnershipMembershipStatus,
  CommunityOwnershipSourceType,
  CommunityOwnershipStatus,
} from './community-ownership-lifecycle.policy';
import { normalizeCommunityId } from './community-preview.model';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface CommunityOwnershipCandidatesPagePayload {
  communityId?: unknown;
  roleFilter?: unknown;
  query?: unknown;
  cursor?: unknown;
}

interface CommunityOwnershipCandidate {
  uid: string;
  label: string;
  avatarUrl: string | null;
  role: 'admin' | 'moderator' | 'member';
}

interface CommunityOwnershipCandidatesPageResponse {
  items: CommunityOwnershipCandidate[];
  nextCursor: string | null;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A gestão de Comunidades ainda não está disponível neste ambiente.'
  );
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

async function resolveOwnershipCursorPosition(
  communityId: string,
  cursor: string
): Promise<{ sortLabel: string; documentId: string } | null> {
  const decoded = decodeCommunityMemberManagementCursor(cursor);
  if (decoded) return decoded;

  const legacyMemberId = normalizeSafeId(cursor);
  if (!legacyMemberId) return null;

  const snapshot = await db
    .collection('community_member_management_index')
    .doc(`${communityId}:${legacyMemberId}`)
    .get();
  const sortLabel = String(snapshot.data()?.['sortLabel'] ?? '').trim();

  return snapshot.exists && sortLabel
    ? { sortLabel, documentId: snapshot.id }
    : null;
}

function ownershipCandidateMatchesRoleFilter(
  role: 'admin' | 'moderator' | 'member',
  roleFilter: CommunityMemberManagementRoleFilter
): boolean {
  return matchesCommunityMemberManagementRoleFilter(role, roleFilter);
}

function assertAuthenticatedUid(auth: unknown): string {
  const source = (auth ?? {}) as {
    uid?: unknown;
    token?: Record<string, unknown>;
  };
  const uid = normalizeSafeId(source.uid);

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (source.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

function normalizeText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeSourceType(value: unknown): CommunityOwnershipSourceType {
  return value === 'community' || value === 'venue' ? value : null;
}

function normalizeCommunityStatus(value: unknown): CommunityOwnershipStatus {
  return value === 'active' || value === 'paused' || value === 'archived'
    ? value
    : null;
}

function normalizeMembershipStatus(
  value: unknown
): CommunityOwnershipMembershipStatus {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

function normalizeMembershipRole(value: unknown): CommunityOwnershipMembershipRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function isTransferCandidateRole(
  role: CommunityOwnershipMembershipRole
): role is 'admin' | 'moderator' | 'member' {
  return role === 'admin' || role === 'moderator' || role === 'member';
}

function assertOwnerMembership(rawMembership: unknown): void {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;

  if (
    normalizeMembershipStatus(membership['status']) !== 'active'
    || normalizeMembershipRole(membership['role']) !== 'owner'
  ) {
    throw new HttpsError(
      'permission-denied',
      'Apenas o proprietário pode executar esta ação.'
    );
  }
}

function assertCommunityOwnerPointer(
  rawCommunity: unknown,
  actorUid: string
): void {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;

  if (normalizeSafeId(community['ownerUid']) !== actorUid) {
    throw new HttpsError(
      'data-loss',
      'A propriedade da Comunidade está inconsistente e exige revisão.'
    );
  }
}

function isTargetAccountEligible(
  rawUser: unknown,
  uid: string,
  rawAgeEligibility: unknown
): boolean {
  try {
    assertCommunityMembershipActorEligible(
      rawUser,
      uid,
      rawAgeEligibility
    );
    return true;
  } catch {
    return false;
  }
}

export const getCommunityOwnershipCandidatesPage =
  onCall<CommunityOwnershipCandidatesPagePayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityOwnershipCandidatesPageResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      const communityId = normalizeCommunityId(request.data?.communityId);
      const roleFilter = normalizeCommunityMemberManagementRoleFilter(
        request.data?.roleFilter
      );
      const searchQuery = normalizeCommunityMemberManagementSearchQuery(
        request.data?.query
      );
      const cursor = normalizeCommunityMemberManagementCursorToken(
        request.data?.cursor
      );
      const providedCursor = String(request.data?.cursor ?? '').trim();

      if (
        !communityId
        || !roleFilter
        || roleFilter === 'owner'
        || searchQuery === null
        || (providedCursor && !cursor)
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Consulta de sucessão inválida.'
        );
      }

      const communityRef = db.collection('communities').doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const [communitySnapshot, actorMembershipSnapshot] =
        await Promise.all([
          communityRef.get(),
          actorMembershipRef.get(),
        ]);
      await assertCommunityMembershipActorEligibleForUid(actorUid);

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      assertOwnerMembership(
        actorMembershipSnapshot.exists ? actorMembershipSnapshot.data() : null
      );

      const community = communitySnapshot.data() ?? {};
      assertCommunityOwnerPointer(community, actorUid);
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const sourceType = normalizeSourceType(source['type']);
      const status = normalizeCommunityStatus(community['status']);

      if (
        sourceType !== 'community'
        || (status !== 'active' && status !== 'paused')
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Esta Comunidade não pode transferir a propriedade agora.'
        );
      }

      let candidateQuery = db
        .collection('community_member_management_index')
        .where('communityId', '==', communityId)
        .where('status', '==', 'active');

      if (roleFilter === 'leadership') {
        candidateQuery = candidateQuery.where('leadership', '==', true);
      } else if (roleFilter !== 'all') {
        candidateQuery = candidateQuery.where(
          'managementRole',
          '==',
          roleFilter
        );
      }

      if (searchQuery) {
        candidateQuery = candidateQuery.where(
          'searchPrefixes',
          'array-contains',
          searchQuery
        );
      }

      candidateQuery = candidateQuery
        .orderBy('sortLabel')
        .orderBy(FieldPath.documentId());

      if (cursor) {
        const position = await resolveOwnershipCursorPosition(
          communityId,
          cursor
        );

        if (!position) {
          throw new HttpsError(
            'invalid-argument',
            'Cursor de sucessão inválido.'
          );
        }

        candidateQuery = candidateQuery.startAfter(
          position.sortLabel,
          position.documentId
        );
      }

      const indexSnapshot = await candidateQuery
        .limit(COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE + 1)
        .get();
      const pageDocuments = indexSnapshot.docs.slice(
        0,
        COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE
      );
      const candidateDocuments = pageDocuments.filter((document) => {
        const memberId = normalizeSafeId(document.data()?.['memberId']);
        return memberId && memberId !== actorUid;
      });
      const [membershipSnapshots, userSnapshots, ageEligibilitySnapshots] =
        await Promise.all([
          Promise.all(
            candidateDocuments.map((document) => {
              const memberId = normalizeSafeId(document.data()?.['memberId']);
              return memberId
                ? communityRef.collection('members').doc(memberId).get()
                : Promise.resolve(null);
            })
          ),
          Promise.all(
            candidateDocuments.map((document) => {
              const memberId = normalizeSafeId(document.data()?.['memberId']);
              return memberId
                ? db.collection('users').doc(memberId).get()
                : Promise.resolve(null);
            })
          ),
          Promise.all(
            candidateDocuments.map((document) => {
              const memberId = normalizeSafeId(document.data()?.['memberId']);
              return memberId
                ? db.collection('age_eligibility_records').doc(memberId).get()
                : Promise.resolve(null);
            })
          ),
        ]);

      const items = candidateDocuments
        .map((document, index): CommunityOwnershipCandidate | null => {
          const projection = document.data() ?? {};
          const memberId = normalizeSafeId(projection['memberId']);
          const membershipSnapshot = membershipSnapshots[index];
          const userSnapshot = userSnapshots[index];
          const ageEligibilitySnapshot = ageEligibilitySnapshots[index];

          if (
            !memberId
            || !membershipSnapshot
            || !membershipSnapshot.exists
            || !userSnapshot
            || !userSnapshot.exists
          ) {
            return null;
          }

          const membership = membershipSnapshot.data() ?? {};
          const role = normalizeMembershipRole(membership['role']);

          if (
            normalizeMembershipStatus(membership['status']) !== 'active'
            || !isTransferCandidateRole(role)
            || !ownershipCandidateMatchesRoleFilter(role, roleFilter)
            || !isTargetAccountEligible(
              userSnapshot.data() ?? {},
              memberId,
              ageEligibilitySnapshot?.exists
                ? ageEligibilitySnapshot.data()
                : null
            )
          ) {
            return null;
          }

          return {
            uid: memberId,
            label:
              normalizeText(projection['label'], 60)
              || normalizeText(userSnapshot.data()?.['nickname'], 60)
              || normalizeText(userSnapshot.data()?.['nome'], 60)
              || 'Participante',
            avatarUrl:
              normalizeHttpsUrl(projection['avatarUrl'])
              ?? normalizeHttpsUrl(userSnapshot.data()?.['avatarUrl'])
              ?? normalizeHttpsUrl(userSnapshot.data()?.['photoURL']),
            role,
          };
        })
        .filter((item): item is CommunityOwnershipCandidate => item !== null)
        .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));

      const hasMore =
        indexSnapshot.docs.length > COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE;
      const lastDocument = pageDocuments.at(-1) ?? null;
      const lastSortLabel = String(
        lastDocument?.data()?.['sortLabel'] ?? ''
      ).trim();

      return {
        items,
        nextCursor:
          hasMore && lastDocument && lastSortLabel
            ? encodeCommunityMemberManagementCursor({
              sortLabel: lastSortLabel,
              documentId: lastDocument.id,
            })
            : null,
        generatedAt: Date.now(),
      };
    }
  );
