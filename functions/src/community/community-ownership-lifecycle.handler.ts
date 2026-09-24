// functions/src/community/community-ownership-lifecycle.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP LIFECYCLE
// -----------------------------------------------------------------------------
// Callables backend-only para:
// - listar membros elegíveis à transferência;
// - transferir a propriedade com idempotência e auditoria;
// - arquivar uma Comunidade sem exclusão física.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import {
  stopOpenCommunityBoostForCommunityInTransaction,
} from '../community-boost/community-boost-authority.service';
import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import { buildCommunityOperationalRequestRetention } from './community-operational-retention.policy';
import { db, FieldValue } from '../firebaseApp';
import {
  MAX_PERSONAL_COMMUNITIES_PER_OWNER,
  isCommunityMemberLimitAllowed,
  resolveCommunityCapacitySponsorRole,
  resolveCommunityConfiguredMemberLimit,
  resolvePersonalCommunityCreationPolicy,
} from './community-capacity.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { hasCommunityLifecycleHold } from './community-lifecycle.policy';
import { resolveCommunityMemberCountDelta } from './community-member-count.policy';
import {
  assertCommunityMembershipActorEligible,
  assertCommunityMembershipActorEligibleForUid,
  assertCommunityMembershipActorEligibleInTransaction,
} from './community-membership-eligibility.service';
import {
  CommunityOwnershipMembershipRole,
  CommunityOwnershipMembershipStatus,
  CommunityOwnershipSourceType,
  CommunityOwnershipStatus,
  evaluateCommunityArchive,
  evaluateCommunityOwnershipIdempotencyReplay,
  evaluateCommunityOwnershipTransfer,
} from './community-ownership-lifecycle.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

interface CommunityIdPayload {
  communityId?: unknown;
}

interface CommunityOwnershipTransferPayload extends CommunityIdPayload {
  targetUid?: unknown;
  requestId?: unknown;
}

interface CommunityArchivePayload extends CommunityIdPayload {
  requestId?: unknown;
  reason?: unknown;
}

interface CommunityOwnershipCandidate {
  uid: string;
  label: string;
  avatarUrl: string | null;
  role: 'admin' | 'moderator' | 'member';
}

interface CommunityOwnershipCandidatesResponse {
  items: CommunityOwnershipCandidate[];
  generatedAt: number;
}

interface CommunityOwnershipTransferResponse {
  communityId: string;
  status: 'transferred';
  previousOwnerUid: string;
  newOwnerUid: string;
  generatedAt: number;
}

interface CommunityArchiveResponse {
  communityId: string;
  status: 'archived';
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_TRANSFER_CANDIDATES = 50;
const MAX_ARCHIVE_REASON_LENGTH = 240;

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A gestão de Comunidades ainda não está disponível neste ambiente.'
  );
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

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
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
  return value === 'active'
    || value === 'paused'
    || value === 'dormant'
    || value === 'archived'
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

function resolveOwnershipReplayCompletedAt(
  decision: ReturnType<typeof evaluateCommunityOwnershipIdempotencyReplay>
): number {
  if (decision.state === 'valid') return decision.completedAt;

  if (decision.state === 'conflict') {
    throw new HttpsError(
      'permission-denied',
      'Esta solicitação idempotente pertence a outra operação.'
    );
  }

  throw new HttpsError(
    'data-loss',
    'O registro idempotente de ownership está inconsistente.',
    { reason: 'community_ownership_idempotency_invalid' }
  );
}

function resolveMemberCountDelta(
  rawCommunity: unknown,
  delta: -1 | 1
): number | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;

  return resolveCommunityMemberCountDelta(metrics['memberCount'], delta);
}

function isTransferCandidateRole(
  role: CommunityOwnershipMembershipRole
): role is 'admin' | 'moderator' | 'member' {
  return role === 'admin' || role === 'moderator' || role === 'member';
}

function normalizeArchiveReason(value: unknown): string | null {
  const normalized = normalizeText(value, MAX_ARCHIVE_REASON_LENGTH + 1);

  if (normalized.length > MAX_ARCHIVE_REASON_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `O motivo deve ter no máximo ${MAX_ARCHIVE_REASON_LENGTH} caracteres.`
    );
  }

  return normalized || null;
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

function throwTransferDecisionError(reason: string | null): never {
  if (reason === 'community_source_not_supported') {
    throw new HttpsError(
      'failed-precondition',
      'A propriedade de um Local segue um fluxo operacional próprio.'
    );
  }

  if (reason === 'owner_required') {
    throw new HttpsError(
      'permission-denied',
      'Apenas o proprietário pode transferir esta Comunidade.'
    );
  }

  if (reason === 'ownership_inconsistent') {
    throw new HttpsError(
      'data-loss',
      'A propriedade da Comunidade está inconsistente e exige revisão.'
    );
  }

  if (reason === 'self_transfer_forbidden') {
    throw new HttpsError(
      'invalid-argument',
      'Selecione outro membro para receber a propriedade.'
    );
  }

  if (reason === 'target_membership_ineligible') {
    throw new HttpsError(
      'failed-precondition',
      'O membro selecionado não possui vínculo ativo elegível.'
    );
  }

  if (reason === 'target_account_ineligible') {
    throw new HttpsError(
      'failed-precondition',
      'A conta selecionada não pode assumir a propriedade agora.',
      { reason: 'target_account_ineligible' }
    );
  }

  if (reason === 'target_ownership_entitlement_ineligible') {
    throw new HttpsError(
      'failed-precondition',
      'O plano da conta selecionada não possui quota ou capacidade para assumir esta Comunidade.',
      { reason: 'target_ownership_entitlement_ineligible' }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Esta Comunidade não pode transferir a propriedade agora.'
  );
}

function throwArchiveDecisionError(reason: string | null): never {
  if (reason === 'community_source_not_supported') {
    throw new HttpsError(
      'failed-precondition',
      'O encerramento de um Local segue um fluxo operacional próprio.'
    );
  }

  if (reason === 'owner_required') {
    throw new HttpsError(
      'permission-denied',
      'Apenas o proprietário pode arquivar esta Comunidade.'
    );
  }

  if (reason === 'ownership_inconsistent') {
    throw new HttpsError(
      'data-loss',
      'A propriedade da Comunidade está inconsistente e exige revisão.'
    );
  }

  if (reason === 'community_lifecycle_hold') {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade possui retenção operacional e não pode ser arquivada.'
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Esta Comunidade não pode ser arquivada agora.'
  );
}

export const getCommunityOwnershipCandidates = onCall<CommunityIdPayload>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityOwnershipCandidatesResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);

    if (!communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida.');
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

    if (sourceType !== 'community' || (status !== 'active' && status !== 'paused')) {
      throw new HttpsError(
        'failed-precondition',
        'Esta Comunidade não pode transferir a propriedade agora.'
      );
    }

    const membershipSnapshot = await communityRef
      .collection('members')
      .where('status', '==', 'active')
      .limit(MAX_TRANSFER_CANDIDATES + 1)
      .get();
    const candidateMemberships = membershipSnapshot.docs.filter((document) => {
      if (document.id === actorUid) return false;
      return isTransferCandidateRole(
        normalizeMembershipRole(document.data()?.['role'])
      );
    });
    const [userSnapshots, ageEligibilitySnapshots] = await Promise.all([
      Promise.all(
        candidateMemberships.map((membership) =>
          db.collection('users').doc(membership.id).get()
        )
      ),
      Promise.all(
        candidateMemberships.map((membership) =>
          db.collection('age_eligibility_records').doc(membership.id).get()
        )
      ),
    ]);

    const items = candidateMemberships
      .map((membership, index): CommunityOwnershipCandidate | null => {
        const userSnapshot = userSnapshots[index];
        const user = userSnapshot?.exists ? userSnapshot.data() ?? {} : null;
        const role = normalizeMembershipRole(membership.data()?.['role']);

        if (
          !user
          || !isTransferCandidateRole(role)
          || !isTargetAccountEligible(
            user,
            membership.id,
            ageEligibilitySnapshots[index]?.exists
              ? ageEligibilitySnapshots[index].data()
              : null
          )
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
      .slice(0, MAX_TRANSFER_CANDIDATES)
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));

    return { items, generatedAt: Date.now() };
  }
);

export const transferCommunityOwnership =
  onCall<CommunityOwnershipTransferPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityOwnershipTransferResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      const communityId = normalizeCommunityId(request.data?.communityId);
      const targetUid = normalizeSafeId(request.data?.targetUid);
      const requestId = normalizeSafeId(request.data?.requestId);

      if (!communityId || !targetUid || !requestId) {
        throw new HttpsError('invalid-argument', 'Transferência inválida.');
      }

      await consumeCommunityRateLimit({
        action: 'ownership_mutation',
        actorUid,
      });

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(communityId);
        const actorMembershipRef = communityRef.collection('members').doc(actorUid);
        const targetMembershipRef = communityRef.collection('members').doc(targetUid);
        const actorUserRef = db.collection('users').doc(actorUid);
        const targetUserRef = db.collection('users').doc(targetUid);
        const targetEntitlementRef = db
          .collection('entitlements')
          .doc(`platform_subscription_${targetUid}`);
        const targetOwnedCommunitiesQuery = db
          .collection('communities')
          .where('ownerUid', '==', targetUid)
          .where('source.type', '==', 'community')
          .where('status', 'in', ['active', 'paused', 'dormant'])
          .limit(MAX_PERSONAL_COMMUNITIES_PER_OWNER + 1);
        const actorIndexRef = db
          .collection('community_user_index')
          .doc(actorUid)
          .collection('items')
          .doc(communityId);
        const targetIndexRef = db
          .collection('community_user_index')
          .doc(targetUid)
          .collection('items')
          .doc(communityId);
        const requestRef = db
          .collection('community_lifecycle_requests')
          .doc(requestId);
        const auditRef = db
          .collection('community_membership_audit')
          .doc(`ownership-transfer-${requestId}`);
        const ownerQuery = communityRef
          .collection('members')
          .where('role', '==', 'owner')
          .where('status', '==', 'active')
          .limit(2);
        const [
          requestSnapshot,
          communitySnapshot,
          actorMembershipSnapshot,
          targetMembershipSnapshot,
          actorUserSnapshot,
          targetUserSnapshot,
          targetEntitlementSnapshot,
          targetOwnedCommunitiesSnapshot,
          ownerSnapshot,
        ] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(communityRef),
          transaction.get(actorMembershipRef),
          transaction.get(targetMembershipRef),
          transaction.get(actorUserRef),
          transaction.get(targetUserRef),
          transaction.get(targetEntitlementRef),
          transaction.get(targetOwnedCommunitiesQuery),
          transaction.get(ownerQuery),
        ]);

        if (requestSnapshot.exists) {
          const completedAt = resolveOwnershipReplayCompletedAt(
            evaluateCommunityOwnershipIdempotencyReplay({
              rawRequest: requestSnapshot.data(),
              expectedOperation: 'transfer',
              expectedRequestId: requestId,
              expectedActorUid: actorUid,
              expectedCommunityId: communityId,
              expectedTargetUid: targetUid,
            })
          );

          return {
            communityId,
            status: 'transferred',
            previousOwnerUid: actorUid,
            newOwnerUid: targetUid,
            generatedAt: completedAt,
          };
        }

        if (!communitySnapshot.exists) {
          throw new HttpsError('not-found', 'Comunidade não encontrada.');
        }

        await assertCommunityMembershipActorEligibleInTransaction(
          transaction,
          actorUid,
          actorUserSnapshot.exists ? actorUserSnapshot.data() : null
        );

        let targetEligible = true;
        try {
          await assertCommunityMembershipActorEligibleInTransaction(
            transaction,
            targetUid,
            targetUserSnapshot.exists ? targetUserSnapshot.data() : null
          );
        } catch {
          targetEligible = false;
        }
        const community = communitySnapshot.data() ?? {};
        const targetUser = targetUserSnapshot.exists
          ? targetUserSnapshot.data() ?? {}
          : {};
        const targetEntitlement = evaluatePlatformSubscriptionEntitlement(
          targetEntitlementSnapshot.exists
            ? targetEntitlementSnapshot.data()
            : null,
          targetUid
        );
        const targetSponsorRole = resolveCommunityCapacitySponsorRole(
          targetEntitlement.active ? targetEntitlement.role : null,
          targetUser['role']
        );
        const targetCreationPolicy = resolvePersonalCommunityCreationPolicy(
          targetSponsorRole
        );
        const targetOwnershipEntitlementEligible =
          targetCreationPolicy.canCreate
          && (
            targetCreationPolicy.maxOwnedCommunities === null
            || targetOwnedCommunitiesSnapshot.size
              < targetCreationPolicy.maxOwnedCommunities
          )
          && isCommunityMemberLimitAllowed(
            resolveCommunityConfiguredMemberLimit(community),
            targetSponsorRole
          );

        assertCommunityOwnerPointer(community, actorUid);
        const source = (community['source'] ?? {}) as Record<string, unknown>;
        const actorMembership = actorMembershipSnapshot.exists
          ? actorMembershipSnapshot.data() ?? {}
          : {};
        const targetMembership = targetMembershipSnapshot.exists
          ? targetMembershipSnapshot.data() ?? {}
          : {};
        const decision = evaluateCommunityOwnershipTransfer({
          sourceType: normalizeSourceType(source['type']),
          communityStatus: normalizeCommunityStatus(community['status']),
          actorUid,
          targetUid,
          actorStatus: normalizeMembershipStatus(actorMembership['status']),
          actorRole: normalizeMembershipRole(actorMembership['role']),
          targetStatus: normalizeMembershipStatus(targetMembership['status']),
          targetRole: normalizeMembershipRole(targetMembership['role']),
          targetAccountEligible: targetEligible,
          targetOwnershipEntitlementEligible,
          activeOwnerCount: ownerSnapshot.size,
        });

        if (
          !decision.allowed
          || !decision.actorNextRole
          || !decision.targetNextRole
        ) {
          throwTransferDecisionError(decision.denialReason);
        }

        const now = Date.now();
        const communityName = normalizeText(community['name'], 80);
        const actorUser = actorUserSnapshot.data() ?? {};
        const targetUserForRevision = targetUserSnapshot.data() ?? {};
        const actorQuotaRevision = Number.isSafeInteger(
          actorUser['communityCreationRevision']
        ) && Number(actorUser['communityCreationRevision']) >= 0
          ? Number(actorUser['communityCreationRevision'])
          : 0;
        const targetQuotaRevision = Number.isSafeInteger(
          targetUserForRevision['communityCreationRevision']
        ) && Number(targetUserForRevision['communityCreationRevision']) >= 0
          ? Number(targetUserForRevision['communityCreationRevision'])
          : 0;

        await stopOpenCommunityBoostForCommunityInTransaction({
          transaction,
          communityId,
          reason: 'community_ownership_transferred',
          now,
          actorUid,
        });

        transaction.update(communityRef, {
          ownerUid: targetUid,
          ownerTransferredAt: now,
          ownerTransferredBy: actorUid,
          capacityRegularization: null,
          updatedAt: now,
        });
        // O mesmo revision lock usado pela criação serializa aquisição/liberação
        // de ownership contra create/transfer concorrentes sem nova coleção.
        transaction.update(actorUserRef, {
          communityCreationRevision: actorQuotaRevision + 1,
          updatedAt: now,
        });
        transaction.update(targetUserRef, {
          communityCreationRevision: targetQuotaRevision + 1,
          updatedAt: now,
        });
        transaction.set(
          actorMembershipRef,
          {
            role: decision.actorNextRole,
            ownershipTransferredAt: now,
            ownershipTransferredTo: targetUid,
            updatedAt: now,
            source: 'ownership-transfer',
          },
          { merge: true }
        );
        transaction.set(
          targetMembershipRef,
          {
            role: decision.targetNextRole,
            ownershipReceivedAt: now,
            ownershipReceivedFrom: actorUid,
            reviewedAt: now,
            reviewedBy: actorUid,
            updatedAt: now,
            source: 'ownership-transfer',
          },
          { merge: true }
        );
        transaction.set(
          actorIndexRef,
          {
            communityId,
            name: communityName,
            source,
            role: decision.actorNextRole,
            status: 'active',
            updatedAt: now,
          },
          { merge: true }
        );
        transaction.set(
          targetIndexRef,
          {
            communityId,
            name: communityName,
            source,
            role: decision.targetNextRole,
            status: 'active',
            updatedAt: now,
          },
          { merge: true }
        );
        transaction.create(auditRef, {
          action: 'community_ownership_transferred',
          communityId,
          actorUid,
          actorRole: 'owner',
          subjectUid: targetUid,
          previousRole: normalizeMembershipRole(targetMembership['role']),
          nextRole: 'owner',
          previousOwnerUid: actorUid,
          nextOwnerUid: targetUid,
          createdAt: now,
          source: 'callable',
        });
        transaction.create(requestRef, {
          ...buildCommunityOperationalRequestRetention('lifecycle', now),
          operation: 'transfer',
          requestId,
          actorUid,
          targetUid,
          communityId,
          status: 'completed',
          completedAt: now,
          createdAt: now,
        });

        return {
          communityId,
          status: 'transferred',
          previousOwnerUid: actorUid,
          newOwnerUid: targetUid,
          generatedAt: now,
        };
      });
    }
  );

export const archiveCommunity = onCall<CommunityArchivePayload>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityArchiveResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    assertRecentAuthentication(
      (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
    );
    const communityId = normalizeCommunityId(request.data?.communityId);
    const requestId = normalizeSafeId(request.data?.requestId);
    const reason = normalizeArchiveReason(request.data?.reason);

    if (!communityId || !requestId) {
      throw new HttpsError('invalid-argument', 'Arquivamento inválido.');
    }

    await consumeCommunityRateLimit({
      action: 'ownership_mutation',
      actorUid,
    });

    return db.runTransaction(async (transaction) => {
      const communityRef = db.collection('communities').doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const actorUserRef = db.collection('users').doc(actorUid);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(communityId);
      const actorIndexRef = db
        .collection('community_user_index')
        .doc(actorUid)
        .collection('items')
        .doc(communityId);
      const requestRef = db
        .collection('community_lifecycle_requests')
        .doc(requestId);
      const auditRef = db
        .collection('community_membership_audit')
        .doc(`community-archive-${requestId}`);
      const ownerQuery = communityRef
        .collection('members')
        .where('role', '==', 'owner')
        .where('status', '==', 'active')
        .limit(2);
      const [
        requestSnapshot,
        communitySnapshot,
        actorMembershipSnapshot,
        actorUserSnapshot,
        ownerSnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(communityRef),
        transaction.get(actorMembershipRef),
        transaction.get(actorUserRef),
        transaction.get(ownerQuery),
      ]);

      if (requestSnapshot.exists) {
        const completedAt = resolveOwnershipReplayCompletedAt(
          evaluateCommunityOwnershipIdempotencyReplay({
            rawRequest: requestSnapshot.data(),
            expectedOperation: 'archive',
            expectedRequestId: requestId,
            expectedActorUid: actorUid,
            expectedCommunityId: communityId,
          })
        );

        return {
          communityId,
          status: 'archived',
          generatedAt: completedAt,
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      await assertCommunityMembershipActorEligibleInTransaction(
        transaction,
        actorUid,
        actorUserSnapshot.exists ? actorUserSnapshot.data() : null
      );
      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const actorMembership = actorMembershipSnapshot.exists
        ? actorMembershipSnapshot.data() ?? {}
        : {};
      const status = normalizeCommunityStatus(community['status']);

      if (status === 'archived' && community['archivedBy'] === actorUid) {
        const now = Date.now();
        transaction.create(requestRef, {
          ...buildCommunityOperationalRequestRetention('lifecycle', now),
          operation: 'archive',
          requestId,
          actorUid,
          communityId,
          status: 'completed',
          completedAt: now,
          createdAt: now,
        });
        return { communityId, status: 'archived', generatedAt: now };
      }

      assertCommunityOwnerPointer(community, actorUid);

      const decision = evaluateCommunityArchive({
        sourceType: normalizeSourceType(source['type']),
        communityStatus: status,
        actorStatus: normalizeMembershipStatus(actorMembership['status']),
        actorRole: normalizeMembershipRole(actorMembership['role']),
        activeOwnerCount: ownerSnapshot.size,
        lifecycleHold: hasCommunityLifecycleHold(community),
      });

      if (
        !decision.allowed
        || decision.idempotent
        || !decision.actorNextRole
        || !decision.actorNextStatus
      ) {
        throwArchiveDecisionError(decision.denialReason);
      }

      const now = Date.now();
      const nextMemberCount = resolveMemberCountDelta(community, -1);

      if (nextMemberCount === null) {
        throw new HttpsError(
          'data-loss',
          'A contagem de participantes desta Comunidade está inconsistente.'
        );
      }

      await stopOpenCommunityBoostForCommunityInTransaction({
        transaction,
        communityId,
        reason: 'community_archived',
        now,
        actorUid,
      });

      const communityPatch: Record<string, unknown> = {
        status: 'archived',
        visibility: 'hidden',
        ownerUid: FieldValue.delete(),
        archivedAt: now,
        archivedBy: actorUid,
        archiveReason: reason,
        'lifecycle.state': 'archived',
        'lifecycle.dormantAt': null,
        'lifecycle.archivedAt': now,
        'lifecycle.scheduledForDeletionAt': null,
        'lifecycle.interactionBlocked': true,
        'lifecycle.policyVersion': 1,
        'lifecycle.updatedAt': now,
        'metrics.memberCount': nextMemberCount,
        updatedAt: now,
      };

      transaction.update(communityRef, communityPatch);
      transaction.set(
        actorMembershipRef,
        {
          role: decision.actorNextRole,
          status: decision.actorNextStatus,
          leftAt: now,
          ownershipReleasedAt: now,
          archivedWithCommunity: true,
          updatedAt: now,
          source: 'community-archive',
        },
        { merge: true }
      );
      transaction.delete(discoveryRef);
      transaction.delete(actorIndexRef);
      transaction.create(auditRef, {
        action: 'community_archived',
        communityId,
        actorUid,
        actorRole: 'owner',
        subjectUid: actorUid,
        previousStatus: status,
        nextStatus: 'archived',
        previousRole: 'owner',
        nextRole: decision.actorNextRole,
        reason,
        memberCount: nextMemberCount,
        createdAt: now,
        source: 'callable',
      });
      transaction.create(requestRef, {
        ...buildCommunityOperationalRequestRetention('lifecycle', now),
        operation: 'archive',
        requestId,
        actorUid,
        communityId,
        status: 'completed',
        completedAt: now,
        createdAt: now,
      });

      return { communityId, status: 'archived', generatedAt: now };
    });
  }
);
