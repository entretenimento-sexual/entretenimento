// functions/src/community/community-member-management.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER MANAGEMENT
// -----------------------------------------------------------------------------
// Callables backend-only para listar membros/bloqueados de forma paginada e
// executar mudanças de papel, remoção, bloqueio e desbloqueio com auditoria.
// O navegador nunca lê ou grava a coleção de memberships diretamente.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { resolveCommunityMemberCountDelta } from './community-member-count.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  CommunityAssignableMemberRole,
  CommunityManagedMemberRole,
  CommunityManagedMemberStatus,
  CommunityMemberManagementAction,
  evaluateCommunityMemberManagement,
} from './community-member-management.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

interface ManagedMembersPagePayload {
  communityId?: unknown;
  status?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface ManageCommunityMemberPayload {
  communityId?: unknown;
  memberId?: unknown;
  action?: unknown;
  nextRole?: unknown;
}

interface CommunityManagedMemberCapabilities {
  assignableRoles: CommunityAssignableMemberRole[];
  canRemove: boolean;
  canBlock: boolean;
  canUnblock: boolean;
}

interface CommunityManagedMemberItem {
  memberId: string;
  label: string;
  avatarUrl: string | null;
  status: 'active' | 'blocked';
  role: 'owner' | 'admin' | 'moderator' | 'member';
  roleBeforeBlock: 'admin' | 'moderator' | 'member' | null;
  updatedAt: number;
  capabilities: CommunityManagedMemberCapabilities;
}

interface CommunityManagedMembersPageResponse {
  items: CommunityManagedMemberItem[];
  nextCursor: string | null;
  generatedAt: number;
}

interface CommunityManageMemberResponse {
  memberId: string;
  status: 'active' | 'blocked' | 'left';
  role: 'admin' | 'moderator' | 'member';
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 40;
const ASSIGNABLE_ROLES: readonly CommunityAssignableMemberRole[] = [
  'admin',
  'moderator',
  'member',
];

function assertManagementRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A gestão de membros ainda não está disponível neste ambiente.',
    { reason: 'community_management_unavailable' }
  );
}

function assertAuthenticatedUid(auth: unknown): string {
  const source = (auth ?? {}) as {
    uid?: unknown;
    token?: Record<string, unknown>;
  };
  const uid = normalizeSafeId(source.uid);

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

function normalizeMembershipStatus(value: unknown): CommunityManagedMemberStatus {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

function normalizeMembershipRole(value: unknown): CommunityManagedMemberRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeAssignableRole(value: unknown): CommunityAssignableMemberRole | null {
  return value === 'admin' || value === 'moderator' || value === 'member'
    ? value
    : null;
}

function normalizeAction(value: unknown): CommunityMemberManagementAction | null {
  return value === 'set_role'
    || value === 'remove'
    || value === 'block'
    || value === 'unblock'
    ? value
    : null;
}

function normalizeListStatus(value: unknown): 'active' | 'blocked' | null {
  return value === 'active' || value === 'blocked' ? value : null;
}

function normalizePageLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
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
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;

  if (source['type'] !== 'community') {
    throw new HttpsError(
      'failed-precondition',
      'A gestão de participantes de um Local segue fluxo próprio.',
      { reason: 'community_source_not_supported' }
    );
  }

  if (
    (community['status'] !== 'active' && community['status'] !== 'paused')
    || moderation['state'] !== 'active'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade não pode ser gerenciada agora.',
      { reason: 'community_not_manageable' }
    );
  }
}

function assertManagerMembership(rawMembership: unknown): {
  status: 'active';
  role: 'owner' | 'admin' | 'moderator';
} {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const status = normalizeMembershipStatus(membership['status']);
  const role = normalizeMembershipRole(membership['role']);

  if (
    status !== 'active'
    || (role !== 'owner' && role !== 'admin' && role !== 'moderator')
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua função não permite gerenciar participantes desta Comunidade.',
      { reason: 'manager_required' }
    );
  }

  return { status, role };
}

function roleBeforeBlock(rawMembership: Record<string, unknown>): CommunityManagedMemberRole {
  return normalizeMembershipRole(rawMembership['blockedPreviousRole']);
}

function blockerRole(rawMembership: Record<string, unknown>): CommunityManagedMemberRole {
  return normalizeMembershipRole(rawMembership['blockedByRole']);
}

function buildCapabilities(
  actorUid: string,
  actor: { status: 'active'; role: 'owner' | 'admin' | 'moderator' },
  targetUid: string,
  rawMembership: Record<string, unknown>
): CommunityManagedMemberCapabilities {
  const targetStatus = normalizeMembershipStatus(rawMembership['status']);
  const targetRole = normalizeMembershipRole(rawMembership['role']);
  const previousRole = roleBeforeBlock(rawMembership);
  const blockedByActor = normalizeSafeId(rawMembership['blockedBy']) === actorUid;

  const base = {
    sourceType: 'community' as const,
    actorUid,
    targetUid,
    actorStatus: actor.status,
    actorRole: actor.role,
    targetStatus,
    targetRole,
    targetRoleBeforeBlock: previousRole,
    targetBlockedByActor: blockedByActor,
    targetBlockedByRole: blockerRole(rawMembership),
  };

  const assignableRoles = ASSIGNABLE_ROLES.filter((nextRole) =>
    evaluateCommunityMemberManagement({
      ...base,
      action: 'set_role',
      nextRole,
    }).allowed
  );

  return {
    assignableRoles,
    canRemove: evaluateCommunityMemberManagement({
      ...base,
      action: 'remove',
      nextRole: null,
    }).allowed,
    canBlock: evaluateCommunityMemberManagement({
      ...base,
      action: 'block',
      nextRole: null,
    }).allowed,
    canUnblock: evaluateCommunityMemberManagement({
      ...base,
      action: 'unblock',
      nextRole: null,
    }).allowed,
  };
}

function throwDecisionError(reason: string | null): never {
  if (reason === 'community_source_not_supported') {
    throw new HttpsError(
      'failed-precondition',
      'Esta ação não está disponível para este tipo de espaço.',
      { reason }
    );
  }

  if (reason === 'manager_required') {
    throw new HttpsError(
      'permission-denied',
      'Sua função não permite gerenciar participantes.',
      { reason }
    );
  }

  if (reason === 'self_action_forbidden') {
    throw new HttpsError(
      'invalid-argument',
      'Use os controles da sua própria participação para alterar seu vínculo.',
      { reason }
    );
  }

  if (reason === 'owner_protected') {
    throw new HttpsError(
      'failed-precondition',
      'O proprietário só pode ser alterado pelo fluxo de transferência de propriedade.',
      { reason }
    );
  }

  if (reason === 'role_change_forbidden' || reason === 'action_forbidden') {
    throw new HttpsError(
      'permission-denied',
      'Sua função não permite executar esta ação sobre este participante.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'O vínculo deste participante não permite esta ação agora.',
    { reason: reason ?? 'target_unavailable' }
  );
}

export const getCommunityMembersForManagement = onCall<ManagedMembersPagePayload>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityManagedMembersPageResponse> => {
    assertManagementRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);
    const status = normalizeListStatus(request.data?.status);
    const cursor = normalizeSafeId(request.data?.cursor);
    const providedCursor = String(request.data?.cursor ?? '').trim();
    const limit = normalizePageLimit(request.data?.limit);

    if (!communityId || !status || (providedCursor && !cursor)) {
      throw new HttpsError(
        'invalid-argument',
        'Consulta de participantes inválida.',
        { reason: 'invalid_management_query' }
      );
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
    const actor = assertManagerMembership(
      actorMembershipSnapshot.exists ? actorMembershipSnapshot.data() : null
    );

    let membersQuery = communityRef
      .collection('members')
      .where('status', '==', status)
      .orderBy(FieldPath.documentId());

    if (cursor) membersQuery = membersQuery.startAfter(cursor);

    const membershipSnapshot = await membersQuery.limit(limit + 2).get();
    const candidateDocuments = membershipSnapshot.docs.filter(
      (document) => document.id !== actorUid
    );
    const pageDocuments = candidateDocuments.slice(0, limit);
    const userSnapshots = await Promise.all(
      pageDocuments.map((document) => db.collection('users').doc(document.id).get())
    );

    const items = pageDocuments
      .map((document, index): CommunityManagedMemberItem | null => {
        const membership = document.data() ?? {};
        const memberStatus = normalizeMembershipStatus(membership['status']);
        const role = normalizeMembershipRole(membership['role']);
        const previousRole = roleBeforeBlock(membership);
        const user = userSnapshots[index]?.exists
          ? userSnapshots[index]?.data() ?? {}
          : {};
        const updatedAt =
          normalizeTimestamp(membership['updatedAt'])
          ?? normalizeTimestamp(membership['joinedAt'])
          ?? normalizeTimestamp(membership['blockedAt'])
          ?? Date.now();

        if (
          (memberStatus !== 'active' && memberStatus !== 'blocked')
          || !role
        ) {
          return null;
        }

        return {
          memberId: document.id,
          label:
            normalizeText(user['nickname'], 60)
            || normalizeText(user['nome'], 60)
            || 'Participante',
          avatarUrl: normalizeHttpsUrl(user['photoURL']),
          status: memberStatus,
          role,
          roleBeforeBlock:
            previousRole === 'admin'
            || previousRole === 'moderator'
            || previousRole === 'member'
              ? previousRole
              : null,
          updatedAt,
          capabilities: buildCapabilities(actorUid, actor, document.id, membership),
        };
      })
      .filter((item): item is CommunityManagedMemberItem => item !== null);

    const hasMore = candidateDocuments.length > limit;
    const lastDocument = pageDocuments.at(-1) ?? null;

    return {
      items,
      nextCursor: hasMore ? (lastDocument?.id ?? null) : null,
      generatedAt: Date.now(),
    };
  }
);

export const manageCommunityMember = onCall<ManageCommunityMemberPayload>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityManageMemberResponse> => {
    assertManagementRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);
    const memberId = normalizeSafeId(request.data?.memberId);
    const action = normalizeAction(request.data?.action);
    const nextRole = normalizeAssignableRole(request.data?.nextRole);

    if (!communityId || !memberId || !action) {
      throw new HttpsError(
        'invalid-argument',
        'Ação de gestão inválida.',
        { reason: 'invalid_member_management_action' }
      );
    }

    if (action === 'set_role' && !nextRole) {
      throw new HttpsError(
        'invalid-argument',
        'Papel comunitário inválido.',
        { reason: 'invalid_community_role' }
      );
    }

    await consumeCommunityRateLimit({
      action: 'member_management',
      actorUid,
    });

    return db.runTransaction(async (transaction) => {
      const communityRef = db.collection('communities').doc(communityId);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const targetMembershipRef = communityRef.collection('members').doc(memberId);
      const actorUserRef = db.collection('users').doc(actorUid);
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
      assertCommunityManageable(communitySnapshot.data());

      const actorMembership = actorMembershipSnapshot.exists
        ? actorMembershipSnapshot.data() ?? {}
        : {};
      const targetMembership = targetMembershipSnapshot.exists
        ? targetMembershipSnapshot.data() ?? {}
        : {};
      const actor = assertManagerMembership(actorMembership);
      const currentTargetRole = normalizeMembershipRole(targetMembership['role']);
      const targetRoleBeforeBlock = roleBeforeBlock(targetMembership);
      const targetBlockedByRole = blockerRole(targetMembership);
      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const decision = evaluateCommunityMemberManagement({
        sourceType: source['type'] === 'community'
          ? 'community'
          : source['type'] === 'venue'
            ? 'venue'
            : null,
        actorUid,
        targetUid: memberId,
        actorStatus: actor.status,
        actorRole: actor.role,
        targetStatus: normalizeMembershipStatus(targetMembership['status']),
        targetRole: currentTargetRole,
        targetRoleBeforeBlock,
        targetBlockedByActor:
          normalizeSafeId(targetMembership['blockedBy']) === actorUid,
        targetBlockedByRole,
        action,
        nextRole,
      });

      if (
        !decision.allowed
        || !decision.targetNextStatus
        || !decision.targetNextRole
      ) {
        throwDecisionError(decision.denialReason);
      }

      const touchesAdministration =
        nextRole === 'admin'
        || currentTargetRole === 'admin'
        || targetRoleBeforeBlock === 'admin';

      if (touchesAdministration) {
        assertRecentAuthentication(
          (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
        );
      }

      if (!decision.idempotent) {
        const now = FieldValue.serverTimestamp();
        const update: Record<string, unknown> = {
          status: decision.targetNextStatus,
          role: decision.targetNextRole,
          updatedAt: now,
          source: 'callable',
        };

        if (action === 'remove') {
          update['leftAt'] = now;
        } else if (action === 'block') {
          update['blockedAt'] = now;
          update['blockedBy'] = actorUid;
          update['blockedByRole'] = actor.role;
          update['blockedPreviousRole'] = currentTargetRole;
        } else if (action === 'unblock') {
          update['unblockedAt'] = now;
          update['blockedAt'] = FieldValue.delete();
          update['blockedBy'] = FieldValue.delete();
          update['blockedByRole'] = FieldValue.delete();
          update['blockedPreviousRole'] = FieldValue.delete();
        } else if (action === 'set_role') {
          update['roleChangedAt'] = now;
          update['roleChangedBy'] = actorUid;
        }

        transaction.set(targetMembershipRef, update, { merge: true });

        if (decision.decrementMemberCount) {
          const nextMemberCount = resolveMemberCountDelta(
            communitySnapshot.data(),
            -1
          );

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

        if (decision.auditAction) {
          transaction.set(auditRef, {
            action: decision.auditAction,
            communityId,
            actorUid,
            actorRole: actor.role,
            subjectUid: memberId,
            previousStatus: normalizeMembershipStatus(targetMembership['status']),
            previousRole: currentTargetRole,
            status: decision.targetNextStatus,
            role: decision.targetNextRole,
            createdAt: now,
            source: 'callable',
          });
        }
      }

      return {
        memberId,
        status: decision.targetNextStatus,
        role: decision.targetNextRole,
        generatedAt: Date.now(),
      };
    });
  }
);
