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
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  CommunityOwnershipMembershipRole,
  CommunityOwnershipMembershipStatus,
  CommunityOwnershipSourceType,
  CommunityOwnershipStatus,
  evaluateCommunityArchive,
  evaluateCommunityOwnershipTransfer,
} from './community-ownership-lifecycle.policy';
import { normalizeCommunityId } from './community-preview.model';

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
  if (isFunctionsEmulatorRuntime()) return;

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
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
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

function isTargetAccountEligible(rawUser: unknown, uid: string): boolean {
  try {
    assertCommunityMembershipActorEligible(rawUser, uid);
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
      'A conta selecionada não pode assumir a propriedade agora.'
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
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityOwnershipCandidatesResponse> => {
    assertPreviewRuntime();
    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);

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
      .slice(0, MAX_TRANSFER_CANDIDATES)
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));

    return { items, generatedAt: Date.now() };
  }
);

export const transferCommunityOwnership =
  onCall<CommunityOwnershipTransferPayload>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<CommunityOwnershipTransferResponse> => {
      assertPreviewRuntime();
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

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(communityId);
        const actorMembershipRef = communityRef.collection('members').doc(actorUid);
        const targetMembershipRef = communityRef.collection('members').doc(targetUid);
        const actorUserRef = db.collection('users').doc(actorUid);
        const targetUserRef = db.collection('users').doc(targetUid);
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
          ownerSnapshot,
        ] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(communityRef),
          transaction.get(actorMembershipRef),
          transaction.get(targetMembershipRef),
          transaction.get(actorUserRef),
          transaction.get(targetUserRef),
          transaction.get(ownerQuery),
        ]);

        if (requestSnapshot.exists) {
          const existing = requestSnapshot.data() ?? {};
          if (
            existing['actorUid'] !== actorUid
            || existing['communityId'] !== communityId
            || existing['operation'] !== 'transfer'
            || existing['targetUid'] !== targetUid
          ) {
            throw new HttpsError(
              'permission-denied',
              'Esta solicitação idempotente pertence a outra operação.'
            );
          }

          return {
            communityId,
            status: 'transferred',
            previousOwnerUid: actorUid,
            newOwnerUid: targetUid,
            generatedAt: Number(existing['completedAt'] ?? Date.now()),
          };
        }

        if (!communitySnapshot.exists) {
          throw new HttpsError('not-found', 'Comunidade não encontrada.');
        }

        assertCommunityMembershipActorEligible(
          actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
          actorUid
        );
        const targetEligible = isTargetAccountEligible(
          targetUserSnapshot.exists ? targetUserSnapshot.data() : null,
          targetUid
        );
        const community = communitySnapshot.data() ?? {};
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

        transaction.update(communityRef, {
          ownerUid: targetUid,
          ownerTransferredAt: now,
          ownerTransferredBy: actorUid,
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
          subjectUid: targetUid,
          previousRole: normalizeMembershipRole(targetMembership['role']),
          nextRole: 'owner',
          previousOwnerUid: actorUid,
          nextOwnerUid: targetUid,
          createdAt: now,
          source: 'callable',
        });
        transaction.create(requestRef, {
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
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityArchiveResponse> => {
    assertPreviewRuntime();
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
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['actorUid'] !== actorUid
          || existing['communityId'] !== communityId
          || existing['operation'] !== 'archive'
        ) {
          throw new HttpsError(
            'permission-denied',
            'Esta solicitação idempotente pertence a outra operação.'
          );
        }

        return {
          communityId,
          status: 'archived',
          generatedAt: Number(existing['completedAt'] ?? Date.now()),
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      assertCommunityMembershipActorEligible(
        actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
        actorUid
      );
      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
      const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
      const actorMembership = actorMembershipSnapshot.exists
        ? actorMembershipSnapshot.data() ?? {}
        : {};
      const status = normalizeCommunityStatus(community['status']);

      if (status === 'archived' && community['archivedBy'] === actorUid) {
        const now = Date.now();
        transaction.create(requestRef, {
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

      const decision = evaluateCommunityArchive({
        sourceType: normalizeSourceType(source['type']),
        communityStatus: status,
        actorStatus: normalizeMembershipStatus(actorMembership['status']),
        actorRole: normalizeMembershipRole(actorMembership['role']),
        activeOwnerCount: ownerSnapshot.size,
        lifecycleHold:
          community['legalHold'] === true
          || moderation['legalHold'] === true
          || lifecycle['hold'] === true,
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

      transaction.update(communityRef, {
        status: 'archived',
        visibility: 'hidden',
        ownerUid: FieldValue.delete(),
        archivedAt: now,
        archivedBy: actorUid,
        archiveReason: reason,
        'lifecycle.state': 'archived',
        'lifecycle.interactionBlocked': true,
        'lifecycle.updatedAt': now,
        updatedAt: now,
      });
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
        subjectUid: actorUid,
        previousStatus: status,
        nextStatus: 'archived',
        previousRole: 'owner',
        nextRole: decision.actorNextRole,
        reason,
        createdAt: now,
        source: 'callable',
      });
      transaction.create(requestRef, {
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
