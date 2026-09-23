// functions/src/community/community-owner-succession-admin.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNER SUCCESSION ADMIN READS
// -----------------------------------------------------------------------------
// Fila e candidatos de sucessão terminal para staff. Escritas continuam nas
// callables canônicas open/nominate/cancel do workflow.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertStaffAuthorization,
} from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import {
  COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE,
  resolveCommunityOwnershipCandidatePageWindow,
} from './community-ownership-candidate-page.policy';
import { normalizeCommunityId } from './community-preview.model';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const CASE_COLLECTION = 'community_owner_succession_cases';
const REQUEST_COLLECTION = 'community_ownership_transfer_requests';
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const CASE_PAGE_LIMIT = 50;

interface SuccessionCasesResponse {
  items: Array<{
    communityId: string;
    communityName: string;
    communityStatus: string;
    previousOwnerUid: string;
    previousOwnerLabel: string;
    trigger: 'owner_terminally_unavailable' | 'confirmed_abandonment';
    deadlineAt: number;
    activeRequestId: string | null;
    activeCandidateUid: string | null;
    activeCandidateLabel: string | null;
    activeRequestExpiresAt: number | null;
  }>;
  generatedAt: number;
}

interface SuccessionCandidatePayload {
  communityId?: unknown;
  cursor?: unknown;
}

interface SuccessionCandidatesResponse {
  items: Array<{
    uid: string;
    label: string;
    avatarUrl: string | null;
    role: 'admin' | 'moderator' | 'member';
  }>;
  nextCursor: string | null;
  generatedAt: number;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A gestão de Comunidades ainda não está disponível neste ambiente.'
  );
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (!SAFE_ID_PATTERN.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Cursor inválido.');
  }
  return normalized;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function userLabel(raw: unknown): string {
  const user = (raw ?? {}) as Record<string, unknown>;
  return normalizeText(user['nickname'], 60)
    || normalizeText(user['nome'], 60)
    || 'Usuário';
}

async function assertLifecycleStaff(
  actorUid: string,
  authToken: Record<string, unknown> | undefined
): Promise<void> {
  await assertStaffAuthorization({
    actorUid,
    authToken,
    requiredPermission: 'users:delete',
  });
}

export const getCommunityOwnerSuccessionCases = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<SuccessionCasesResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = String(request.auth?.uid ?? '').trim();
    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Staff não autenticado.');
    }
    await assertLifecycleStaff(
      actorUid,
      (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
    );

    const casesSnapshot = await db
      .collection(CASE_COLLECTION)
      .where('status', '==', 'open')
      .limit(CASE_PAGE_LIMIT)
      .get();
    const now = Date.now();

    const items = await Promise.all(
      casesSnapshot.docs.map(async (caseDocument) => {
        const successionCase = caseDocument.data() ?? {};
        const communityId = normalizeCommunityId(
          successionCase['communityId'] ?? caseDocument.id
        );
        const previousOwnerUid = normalizeId(
          successionCase['previousOwnerUid']
        );
        const deadlineAt = normalizeEpoch(successionCase['deadlineAt']);
        const trigger =
          successionCase['trigger'] === 'confirmed_abandonment'
            ? 'confirmed_abandonment' as const
            : 'owner_terminally_unavailable' as const;

        if (!communityId || !previousOwnerUid || !deadlineAt) return null;

        const activeRequestId = normalizeId(successionCase['activeRequestId']);
        const [communitySnapshot, previousOwnerSnapshot, activeRequestSnapshot] =
          await Promise.all([
            db.collection('communities').doc(communityId).get(),
            db.collection('users').doc(previousOwnerUid).get(),
            activeRequestId
              ? db.collection(REQUEST_COLLECTION).doc(activeRequestId).get()
              : Promise.resolve(null),
          ]);
        const community = communitySnapshot.exists
          ? communitySnapshot.data() ?? {}
          : {};
        const activeRequest = activeRequestSnapshot?.exists
          ? activeRequestSnapshot.data() ?? {}
          : {};
        const activeCandidateUid = normalizeId(activeRequest['candidateUid']);
        const activeCandidateSnapshot = activeCandidateUid
          ? await db.collection('users').doc(activeCandidateUid).get()
          : null;

        return {
          communityId,
          communityName:
            normalizeText(community['name'], 80) || 'Comunidade',
          communityStatus:
            normalizeText(community['status'], 24) || 'unknown',
          previousOwnerUid,
          previousOwnerLabel: previousOwnerSnapshot.exists
            ? userLabel(previousOwnerSnapshot.data())
            : 'Conta indisponível',
          trigger,
          deadlineAt,
          activeRequestId,
          activeCandidateUid,
          activeCandidateLabel: activeCandidateSnapshot?.exists
            ? userLabel(activeCandidateSnapshot.data())
            : null,
          activeRequestExpiresAt:
            normalizeEpoch(activeRequest['expiresAt']),
        };
      })
    );

    return {
      items: items
        .filter((item): item is NonNullable<typeof item> => !!item)
        .sort((left, right) => left.deadlineAt - right.deadlineAt),
      generatedAt: now,
    };
  }
);

export const getCommunityOwnerSuccessionCandidatesPage =
  onCall<SuccessionCandidatePayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<SuccessionCandidatesResponse> => {
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      await assertLifecycleStaff(
        actorUid,
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      const communityId = normalizeCommunityId(request.data?.communityId);
      const cursor = normalizeCursor(request.data?.cursor);

      if (!communityId) {
        throw new HttpsError('invalid-argument', 'Comunidade inválida.');
      }

      const caseRef = db.collection(CASE_COLLECTION).doc(communityId);
      const communityRef = db.collection('communities').doc(communityId);
      const [caseSnapshot, communitySnapshot] = await Promise.all([
        caseRef.get(),
        communityRef.get(),
      ]);
      const successionCase = caseSnapshot.exists
        ? caseSnapshot.data() ?? {}
        : {};
      const deadlineAt = normalizeEpoch(successionCase['deadlineAt']);

      if (
        successionCase['status'] !== 'open'
        || !deadlineAt
        || deadlineAt <= Date.now()
        || !communitySnapshot.exists
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O caso de sucessão não está aberto.',
          { reason: 'community_ownership_succession_closed' }
        );
      }

      const previousOwnerUid = normalizeId(
        successionCase['previousOwnerUid']
      );
      let query = communityRef
        .collection('members')
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId())
        .limit(COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE + 1);

      if (cursor) query = query.startAfter(cursor);

      const membershipSnapshot = await query.get();
      const page = resolveCommunityOwnershipCandidatePageWindow(
        membershipSnapshot.docs
      );
      const candidates = page.documents.filter((document) =>
        document.id !== previousOwnerUid
        && ['admin', 'moderator', 'member'].includes(
          String(document.data()?.['role'] ?? '')
        )
      );
      const [userSnapshots, ageSnapshots] = await Promise.all([
        Promise.all(
          candidates.map((candidate) =>
            db.collection('users').doc(candidate.id).get()
          )
        ),
        Promise.all(
          candidates.map((candidate) =>
            db.collection('age_eligibility_records').doc(candidate.id).get()
          )
        ),
      ]);

      const items = candidates
        .map((membership, index) => {
          const userSnapshot = userSnapshots[index];
          const user = userSnapshot?.exists
            ? userSnapshot.data() ?? {}
            : null;
          if (!user) return null;

          try {
            assertCommunityMembershipActorEligible(
              user,
              membership.id,
              ageSnapshots[index]?.exists
                ? ageSnapshots[index].data()
                : null
            );
          } catch {
            return null;
          }

          const rawRole = String(membership.data()?.['role'] ?? '');
          const role: 'admin' | 'moderator' | 'member' | null =
            rawRole === 'admin'
            || rawRole === 'moderator'
            || rawRole === 'member'
              ? rawRole
              : null;
          if (!role) return null;

          return {
            uid: membership.id,
            label: userLabel(user),
            avatarUrl: normalizeHttpsUrl(user['photoURL']),
            role,
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .sort((left, right) =>
          left.label.localeCompare(right.label, 'pt-BR')
        );

      return {
        items,
        nextCursor: page.nextCursor,
        generatedAt: Date.now(),
      };
    }
  );

