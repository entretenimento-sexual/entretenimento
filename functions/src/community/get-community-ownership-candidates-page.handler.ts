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
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE,
  resolveCommunityOwnershipCandidatePageWindow,
} from './community-ownership-candidate-page.policy';
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

function normalizeCandidateCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;

  if (!SAFE_ID_PATTERN.test(normalized)) {
    throw new HttpsError(
      'invalid-argument',
      'Cursor de sucessão inválido.',
      { reason: 'invalid_ownership_candidate_cursor' }
    );
  }

  return normalized;
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

function isTargetAccountEligible(rawUser: unknown, uid: string): boolean {
  try {
    assertCommunityMembershipActorEligible(rawUser, uid);
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
      const cursor = normalizeCandidateCursor(request.data?.cursor);

      if (!communityId) {
        throw new HttpsError('invalid-argument', 'Comunidade inválida.');
      }

      const communityRef = db.collection('communities').doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const actorUserRef = db.collection('users').doc(actorUid);
      const [communitySnapshot, actorMembershipSnapshot, actorUserSnapshot] =
        await Promise.all([
          communityRef.get(),
          actorMembershipRef.get(),
          actorUserRef.get(),
        ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      assertCommunityMembershipActorEligible(
        actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
        actorUid
      );
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

      let membershipQuery = communityRef
        .collection('members')
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId())
        .limit(COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE + 1);

      if (cursor) {
        membershipQuery = membershipQuery.startAfter(cursor);
      }

      const membershipSnapshot = await membershipQuery.get();
      const page = resolveCommunityOwnershipCandidatePageWindow(
        membershipSnapshot.docs
      );
      const candidateMemberships = page.documents.filter((document) => {
        if (document.id === actorUid) return false;
        return isTransferCandidateRole(
          normalizeMembershipRole(document.data()?.['role'])
        );
      });
      const userSnapshots = await Promise.all(
        candidateMemberships.map((membership) =>
          db.collection('users').doc(membership.id).get()
        )
      );

      const items = candidateMemberships
        .map((membership, index): CommunityOwnershipCandidate | null => {
          const userSnapshot = userSnapshots[index];
          const user = userSnapshot?.exists ? userSnapshot.data() ?? {} : null;
          const role = normalizeMembershipRole(membership.data()?.['role']);

          if (
            !user
            || !isTransferCandidateRole(role)
            || !isTargetAccountEligible(user, membership.id)
          ) {
            return null;
          }

          const label = normalizeText(user['nickname'], 60)
            || normalizeText(user['nome'], 60)
            || 'Participante';

          return {
            uid: membership.id,
            label,
            avatarUrl: normalizeHttpsUrl(user['photoURL']),
            role,
          };
        })
        .filter((item): item is CommunityOwnershipCandidate => item !== null)
        .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));

      return {
        items,
        nextCursor: page.nextCursor,
        generatedAt: Date.now(),
      };
    }
  );
