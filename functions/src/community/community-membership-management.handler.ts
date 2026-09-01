// functions/src/community/community-membership-management.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP MANAGEMENT
// -----------------------------------------------------------------------------
// Comandos backend-only para saída voluntária e revisão de solicitações.
// O navegador nunca lista memberships nem grava estados diretamente.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityAcceptingNewMembers,
  getCommunityCapacityForOwnerInTransaction,
} from './community-capacity.service';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { resolveCommunityMemberCountDelta } from './community-member-count.policy';
import { buildCommunityMembershipReviewAudit } from './community-membership-audit.model';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import {
  CommunityMembershipLeaveCommunityStatus,
  CommunityMembershipReviewAction,
  CommunityMembershipRole,
  CommunityMembershipStatus,
  evaluateCommunityMembershipLeave,
  evaluateCommunityMembershipReview,
} from './community-membership-request.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

interface CommunityIdPayload {
  communityId?: unknown;
}

interface ReviewCommunityMembershipPayload extends CommunityIdPayload {
  memberId?: unknown;
  action?: unknown;
}

interface CommunityMembershipRequestItem {
  memberId: string;
  label: string;
  avatarUrl: string | null;
  requestedAt: number;
}

interface CommunityMembershipRequestsResponse {
  items: CommunityMembershipRequestItem[];
  generatedAt: number;
}

interface CommunityMembershipLifecycleResponse {
  status: 'left';
  viewerMode: 'visitor';
  canInteract: false;
}

interface CommunityMembershipReviewResponse {
  memberId: string;
  status: 'active' | 'left';
  viewerMode: 'member' | 'visitor';
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_PENDING_REQUESTS = 24;

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.',
    { reason: 'community_runtime_unavailable' }
  );
}

function assertAuthenticatedUid(auth: unknown): string {
  const source = (auth ?? {}) as {
    uid?: unknown;
    token?: Record<string, unknown>;
  };
  const uid = String(source.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Usuário não autenticado.',
      { reason: 'authentication_required' }
    );
  }

  if (source.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.',
      { reason: 'email_verification_required' }
    );
  }

  return uid;
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeMembershipStatus(
  value: unknown
): CommunityMembershipStatus | null {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

function normalizeMembershipRole(value: unknown): CommunityMembershipRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeCommunityLeaveStatus(
  value: unknown
): CommunityMembershipLeaveCommunityStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'dormant'
    || value === 'archived'
    || value === 'scheduled_for_deletion'
    ? value
    : null;
}

function normalizeReviewAction(
  value: unknown
): CommunityMembershipReviewAction | null {
  return value === 'approve' || value === 'reject' ? value : null;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
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

function normalizeTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);

    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
}

function resolveMemberCountDelta(
  rawCommunity: unknown,
  delta: -1 | 1
): number | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;

  return resolveCommunityMemberCountDelta(metrics['memberCount'], delta);
}

function assertCommunityManageable(rawCommunity: unknown): void {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const status = community['status'];

  if (
    (status !== 'active' && status !== 'paused')
    || moderation['state'] !== 'active'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Esta comunidade não pode ser moderada agora.',
      { reason: 'community_not_manageable' }
    );
  }
}

function assertModerator(
  membership: unknown
): { status: 'active'; role: 'owner' | 'admin' | 'moderator' } {
  const source = (membership ?? {}) as Record<string, unknown>;
  const status = normalizeMembershipStatus(source['status']);
  const role = normalizeMembershipRole(source['role']);

  if (
    status !== 'active'
    || (role !== 'owner' && role !== 'admin' && role !== 'moderator')
  ) {
    throw new HttpsError(
      'permission-denied',
      'Apenas a moderação da comunidade pode revisar solicitações.',
      { reason: 'moderator_required' }
    );
  }

  return { status, role };
}

function throwLeaveDecisionError(reason: string | null): never {
  if (reason === 'membership_blocked') {
    throw new HttpsError(
      'permission-denied',
      'Este vínculo está bloqueado e não pode ser alterado.',
      { reason }
    );
  }

  if (reason === 'owner_transfer_required') {
    throw new HttpsError(
      'failed-precondition',
      'Transfira a propriedade antes de sair da comunidade.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Você não possui participação ativa ou pendente nesta comunidade.',
    { reason: reason ?? 'membership_not_found' }
  );
}

function throwReviewDecisionError(reason: string | null): never {
  if (reason === 'moderator_required') {
    throw new HttpsError(
      'permission-denied',
      'Apenas a moderação pode revisar solicitações.',
      { reason }
    );
  }

  if (reason === 'self_review_forbidden') {
    throw new HttpsError(
      'failed-precondition',
      'Você não pode revisar o próprio vínculo.',
      { reason }
    );
  }

  if (reason === 'membership_blocked' || reason === 'protected_membership') {
    throw new HttpsError(
      'permission-denied',
      'Este vínculo não pode ser alterado por esta operação.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'A solicitação já foi processada ou não está pendente.',
    { reason: reason ?? 'request_not_pending' }
  );
}

function sanitizePendingRequest(
  memberId: string,
  rawMembership: unknown,
  rawUser: unknown
): CommunityMembershipRequestItem | null {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const user = (rawUser ?? {}) as Record<string, unknown>;
  const safeMemberId = normalizeSafeId(memberId);
  const status = normalizeMembershipStatus(membership['status']);
  const role = normalizeMembershipRole(membership['role']);
  const requestedAt =
    normalizeTimestamp(membership['requestedAt'])
    ?? normalizeTimestamp(membership['updatedAt']);

  if (!safeMemberId || status !== 'pending' || role !== 'member' || !requestedAt) {
    return null;
  }

  const label =
    normalizeText(user['nickname'], 60)
    || normalizeText(user['nome'], 60)
    || 'Participante';

  return {
    memberId: safeMemberId,
    label,
    avatarUrl: normalizeHttpsUrl(user['photoURL']),
    requestedAt,
  };
}

export const getCommunityMembershipRequests = onCall<CommunityIdPayload>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityMembershipRequestsResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);

    if (!communityId) {
      throw new HttpsError(
        'invalid-argument',
        'Comunidade inválida.',
        { reason: 'invalid_community_id' }
      );
    }

    return db.runTransaction(async (transaction) => {
      const communityRef = db.collection('communities').doc(communityId);
      const actorMembershipRef = communityRef
        .collection('members')
        .doc(actorUid);
      const actorUserRef = db.collection('users').doc(actorUid);
      const [communitySnapshot, actorMembershipSnapshot, actorUserSnapshot] =
        await Promise.all([
          transaction.get(communityRef),
          transaction.get(actorMembershipRef),
          transaction.get(actorUserRef),
        ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }

      assertCommunityMembershipActorEligible(
        actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
        actorUid
      );
      assertCommunityManageable(communitySnapshot.data());
      assertModerator(
        actorMembershipSnapshot.exists ? actorMembershipSnapshot.data() : null
      );

      const pendingQuery = communityRef
        .collection('members')
        .where('status', '==', 'pending')
        .limit(MAX_PENDING_REQUESTS);
      const pendingSnapshot = await transaction.get(pendingQuery);
      const userSnapshots = await Promise.all(
        pendingSnapshot.docs.map((document) =>
          transaction.get(db.collection('users').doc(document.id))
        )
      );

      const items = pendingSnapshot.docs
        .map((document, index) =>
          sanitizePendingRequest(
            document.id,
            document.data(),
            userSnapshots[index]?.exists ? userSnapshots[index]?.data() : null
          )
        )
        .filter((item): item is CommunityMembershipRequestItem => item !== null)
        .sort((left, right) => right.requestedAt - left.requestedAt);

      return { items, generatedAt: Date.now() };
    });
  }
);

export const leaveCommunityMembership = onCall<CommunityIdPayload>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityMembershipLifecycleResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const uid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);

    if (!communityId) {
      throw new HttpsError(
        'invalid-argument',
        'Comunidade inválida.',
        { reason: 'invalid_community_id' }
      );
    }

    return db.runTransaction(async (transaction) => {
      const communityRef = db.collection('communities').doc(communityId);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(communityId);
      const membershipRef = communityRef.collection('members').doc(uid);
      const auditRef = db.collection('community_membership_audit').doc();
      const [communitySnapshot, discoverySnapshot, membershipSnapshot] =
        await Promise.all([
          transaction.get(communityRef),
          transaction.get(discoveryRef),
          transaction.get(membershipRef),
        ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }

      const community = communitySnapshot.data() ?? {};
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data()
        : null;
      const existingRole = normalizeMembershipRole(membership?.['role']);
      const decision = evaluateCommunityMembershipLeave({
        communityStatus: normalizeCommunityLeaveStatus(community['status']),
        existingStatus: normalizeMembershipStatus(membership?.['status']),
        existingRole,
      });

      if (!decision.allowed || !decision.targetStatus) {
        throwLeaveDecisionError(decision.denialReason);
      }

      if (!decision.idempotent) {
        const now = FieldValue.serverTimestamp();
        const membershipPatch: Record<string, unknown> = {
          status: 'left',
          leftAt: now,
          updatedAt: now,
          source: 'callable',
        };

        if (decision.releaseOwnership) {
          membershipPatch['role'] = 'member';
          membershipPatch['ownershipReleasedAt'] = now;
          membershipPatch['ownershipReleaseReason'] = 'terminal-community-leave';
        }

        transaction.set(membershipRef, membershipPatch, { merge: true });

        const communityPatch: Record<string, unknown> = {};
        let nextMemberCount: number | null = null;

        if (decision.decrementMemberCount) {
          nextMemberCount = resolveMemberCountDelta(community, -1);
          if (nextMemberCount !== null) {
            communityPatch['metrics.memberCount'] = nextMemberCount;
          }
        }

        const ownerPointerReleased =
          decision.releaseOwnership
          && normalizeSafeId(community['ownerUid']) === uid;

        if (ownerPointerReleased) {
          communityPatch['ownerUid'] = FieldValue.delete();
          communityPatch['ownershipReleasedAt'] = now;
          communityPatch['ownershipReleasedBy'] = uid;
        }

        if (Object.keys(communityPatch).length > 0) {
          communityPatch['updatedAt'] = now;
          transaction.update(communityRef, communityPatch);
        }

        if (discoverySnapshot.exists && nextMemberCount !== null) {
          transaction.update(discoveryRef, {
            'metrics.memberCount': nextMemberCount,
            updatedAt: now,
          });
        }

        transaction.set(auditRef, {
          action: decision.auditAction,
          communityId,
          actorUid: uid,
          subjectUid: uid,
          previousRole: existingRole,
          role: decision.releaseOwnership ? 'member' : existingRole,
          status: 'left',
          ownershipReleased: decision.releaseOwnership,
          ownerPointerReleased,
          createdAt: now,
          source: 'callable',
        });
      }

      return {
        status: 'left',
        viewerMode: 'visitor',
        canInteract: false,
      };
    });
  }
);

export const reviewCommunityMembership =
  onCall<ReviewCommunityMembershipPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityMembershipReviewResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      const communityId = normalizeCommunityId(request.data?.communityId);
      const memberId = normalizeSafeId(request.data?.memberId);
      const action = normalizeReviewAction(request.data?.action);

      if (!communityId || !memberId || !action) {
        throw new HttpsError(
          'invalid-argument',
          'Solicitação inválida.',
          { reason: 'invalid_membership_review' }
        );
      }

      await consumeCommunityRateLimit({
        action: 'membership_review',
        actorUid,
      });

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(communityId);
        const discoveryRef = db
          .collection('community_discovery_index')
          .doc(communityId);
        const actorMembershipRef = communityRef
          .collection('members')
          .doc(actorUid);
        const targetMembershipRef = communityRef
          .collection('members')
          .doc(memberId);
        const actorUserRef = db.collection('users').doc(actorUid);
        const targetUserRef = db.collection('users').doc(memberId);
        const auditRef = db.collection('community_membership_audit').doc();
        const [
          communitySnapshot,
          discoverySnapshot,
          actorMembershipSnapshot,
          targetMembershipSnapshot,
          actorUserSnapshot,
        ] = await Promise.all([
          transaction.get(communityRef),
          transaction.get(discoveryRef),
          transaction.get(actorMembershipRef),
          transaction.get(targetMembershipRef),
          transaction.get(actorUserRef),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Comunidade não encontrada.',
            { reason: 'community_not_found' }
          );
        }

        assertCommunityMembershipActorEligible(
          actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
          actorUid
        );
        const community = communitySnapshot.data() ?? null;
        assertCommunityManageable(community);
        const actor = assertModerator(
          actorMembershipSnapshot.exists ? actorMembershipSnapshot.data() : null
        );
        const target = targetMembershipSnapshot.exists
          ? targetMembershipSnapshot.data()
          : null;
        const decision = evaluateCommunityMembershipReview({
          actorActive: actor.status === 'active',
          actorRole: actor.role,
          targetIsActor: actorUid === memberId,
          targetStatus: normalizeMembershipStatus(target?.['status']),
          targetRole: normalizeMembershipRole(target?.['role']),
          action,
        });

        if (!decision.allowed || !decision.targetStatus) {
          throwReviewDecisionError(decision.denialReason);
        }

        if (!decision.idempotent && decision.targetStatus === 'active') {
          const targetUserSnapshot = await transaction.get(targetUserRef);
          assertCommunityMembershipActorEligible(
            targetUserSnapshot.exists ? targetUserSnapshot.data() : null,
            memberId
          );
        }

        if (decision.incrementMemberCount) {
          const capacity = await getCommunityCapacityForOwnerInTransaction(
            transaction,
            community
          );
          assertCommunityAcceptingNewMembers(capacity);
        }

        if (!decision.idempotent) {
          const now = FieldValue.serverTimestamp();
          const approved = decision.targetStatus === 'active';

          transaction.set(
            targetMembershipRef,
            {
              role: 'member',
              status: decision.targetStatus,
              joinedAt: approved ? now : null,
              leftAt: approved ? null : now,
              reviewedAt: now,
              reviewedBy: actorUid,
              requestResolution: approved ? 'approved' : 'rejected',
              updatedAt: now,
              source: 'callable',
            },
            { merge: true }
          );

          if (decision.incrementMemberCount) {
            const nextMemberCount = resolveMemberCountDelta(community, 1);

            if (nextMemberCount !== null) {
              transaction.update(communityRef, {
                'metrics.memberCount': nextMemberCount,
                updatedAt: now,
              });

              if (discoverySnapshot.exists) {
                transaction.update(discoveryRef, {
                  'metrics.memberCount': nextMemberCount,
                  updatedAt: now,
                });
              }
            }
          }

          transaction.set(
            auditRef,
            buildCommunityMembershipReviewAudit(
              {
                action: decision.auditAction,
                communityId,
                actorUid,
                actorRole: actor.role,
                subjectUid: memberId,
                status: decision.targetStatus,
              },
              now
            )
          );
        }

        return {
          memberId,
          status: decision.targetStatus,
          viewerMode: decision.targetStatus === 'active' ? 'member' : 'visitor',
        };
      });
    }
  );
