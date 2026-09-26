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
import {
  stopOpenCommunityBoostForCommunityInTransaction,
} from '../community-boost/community-boost-authority.service';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  resolveCanonicalCommunityManagerRole,
  resolveCanonicalCommunityMemberRole,
} from './community-canonical-owner.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { resolveCommunityMemberCountDelta } from './community-member-count.policy';
import {
  assertCommunityMembershipActorEligible,
  assertCommunityMembershipActorEligibleInTransaction,
} from './community-membership-eligibility.service';
import {
  CommunityAssignableMemberRole,
  CommunityManagedMemberRole,
  CommunityManagedMemberStatus,
  CommunityMemberManagementAction,
  evaluateCommunityMemberManagement,
} from './community-member-management.policy';
import {
  buildCommunityMemberLifecycleNotificationCopy,
  buildCommunityMemberLifecycleNotificationId,
  buildCommunityNotificationRoute,
  canReceiveCommunityEssentialNotification,
  type CommunityMemberLifecycleNotificationAction,
  type CommunityNotificationUser,
} from './community-notification.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import {
  CommunityMemberManagementRoleFilter,
  decodeCommunityMemberManagementCursor,
  encodeCommunityMemberManagementCursor,
  matchesCommunityMemberManagementRoleFilter,
  normalizeCommunityMemberManagementCursorToken,
  normalizeCommunityMemberManagementRoleFilter,
  normalizeCommunityMemberManagementSearchQuery,
} from './community-member-management-index.policy';
import { syncCommunityUserIndexInTransaction } from './community-user-index.transaction';

interface ManagedMembersPagePayload {
  communityId?: unknown;
  status?: unknown;
  roleFilter?: unknown;
  query?: unknown;
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

function managementIndexProjectionId(
  communityId: string,
  memberId: string
): string {
  return `${communityId}:${memberId}`;
}

async function resolveManagementCursorPosition(
  communityId: string,
  cursor: string
): Promise<{ sortLabel: string; documentId: string } | null> {
  const decoded = decodeCommunityMemberManagementCursor(cursor);
  if (decoded) return decoded;

  const legacyMemberId = normalizeSafeId(cursor);
  if (!legacyMemberId) return null;

  const legacySnapshot = await db
    .collection('community_member_management_index')
    .doc(managementIndexProjectionId(communityId, legacyMemberId))
    .get();

  if (!legacySnapshot.exists) return null;

  const sortLabel = String(legacySnapshot.data()?.['sortLabel'] ?? '').trim();
  return sortLabel
    ? { sortLabel, documentId: legacySnapshot.id }
    : null;
}

function resolveManagementFilterRole(
  rawMembership: Record<string, unknown>,
  status: 'active' | 'blocked'
): 'owner' | 'admin' | 'moderator' | 'member' | null {
  if (status === 'blocked') {
    const previousRole = roleBeforeBlock(rawMembership);
    if (previousRole) return previousRole;
  }

  return normalizeMembershipRole(rawMembership['role']);
}

function membershipMatchesManagementRoleFilter(
  rawMembership: Record<string, unknown>,
  status: 'active' | 'blocked',
  roleFilter: CommunityMemberManagementRoleFilter
): boolean {
  const role = resolveManagementFilterRole(rawMembership, status);
  return role
    ? matchesCommunityMemberManagementRoleFilter(role, roleFilter)
    : false;
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

function assertManagerMembership(
  rawCommunity: unknown,
  actorUid: string,
  rawMembership: unknown
): {
  status: 'active';
  role: 'owner' | 'admin' | 'moderator';
} {
  const role = resolveCanonicalCommunityManagerRole(
    rawCommunity,
    actorUid,
    rawMembership
  );

  if (!role) {
    throw new HttpsError(
      'permission-denied',
      'Sua função não permite gerenciar participantes desta Comunidade.',
      { reason: 'manager_required' }
    );
  }

  return { status: 'active', role };
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
  rawMembership: Record<string, unknown>,
  rawCommunity: unknown
): CommunityManagedMemberCapabilities {
  const targetStatus = normalizeMembershipStatus(rawMembership['status']);
  const targetRole = resolveCanonicalCommunityMemberRole(
    rawCommunity,
    targetUid,
    normalizeMembershipRole(rawMembership['role'])
  );
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
    const limit = normalizePageLimit(request.data?.limit);

    if (
      !communityId
      || !status
      || !roleFilter
      || searchQuery === null
      || (providedCursor && !cursor)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Consulta de participantes inválida.',
        { reason: 'invalid_management_query' }
      );
    }

    const communityRef = db.collection('communities').doc(communityId);
    const actorMembershipRef = communityRef.collection('members').doc(actorUid);
    const actorUserRef = db.collection('users').doc(actorUid);
    const actorAgeEligibilityRef = db
      .collection('age_eligibility_records')
      .doc(actorUid);
    const [
      communitySnapshot,
      actorMembershipSnapshot,
      actorUserSnapshot,
      actorAgeEligibilitySnapshot,
    ] = await Promise.all([
      communityRef.get(),
      actorMembershipRef.get(),
      actorUserRef.get(),
      actorAgeEligibilityRef.get(),
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
      actorUid,
      actorAgeEligibilitySnapshot.exists
        ? actorAgeEligibilitySnapshot.data()
        : null
    );
    const community = communitySnapshot.data() ?? {};
    assertCommunityManageable(community);
    const actor = assertManagerMembership(
      community,
      actorUid,
      actorMembershipSnapshot.exists ? actorMembershipSnapshot.data() : null
    );

    let membersQuery = db
      .collection('community_member_management_index')
      .where('communityId', '==', communityId)
      .where('status', '==', status);

    if (roleFilter === 'leadership') {
      membersQuery = membersQuery.where('leadership', '==', true);
    } else if (roleFilter !== 'all') {
      membersQuery = membersQuery.where('managementRole', '==', roleFilter);
    }

    if (searchQuery) {
      membersQuery = membersQuery.where(
        'searchPrefixes',
        'array-contains',
        searchQuery
      );
    }

    membersQuery = membersQuery
      .orderBy('sortLabel')
      .orderBy(FieldPath.documentId());

    if (cursor) {
      const cursorPosition = await resolveManagementCursorPosition(
        communityId,
        cursor
      );

      if (!cursorPosition) {
        throw new HttpsError(
          'invalid-argument',
          'Cursor de participantes inválido.',
          { reason: 'invalid_management_query' }
        );
      }

      membersQuery = membersQuery.startAfter(
        cursorPosition.sortLabel,
        cursorPosition.documentId
      );
    }

    const indexSnapshot = await membersQuery.limit(limit + 1).get();
    const pageDocuments = indexSnapshot.docs.slice(0, limit);
    const membershipSnapshots = await Promise.all(
      pageDocuments.map((document) => {
        const memberId = normalizeSafeId(document.data()?.['memberId']);
        return memberId
          ? communityRef.collection('members').doc(memberId).get()
          : Promise.resolve(null);
      })
    );

    const items = pageDocuments
      .map((document, index): CommunityManagedMemberItem | null => {
        const projection = document.data() ?? {};
        const memberId = normalizeSafeId(projection['memberId']);
        const membershipSnapshot = membershipSnapshots[index];

        if (
          !memberId
          || memberId === actorUid
          || !membershipSnapshot
          || !membershipSnapshot.exists
        ) {
          return null;
        }

        const membership = membershipSnapshot.data() ?? {};
        const memberStatus = normalizeMembershipStatus(membership['status']);
        const role = resolveCanonicalCommunityMemberRole(
          community,
          memberId,
          normalizeMembershipRole(membership['role'])
        );
        const previousRole = roleBeforeBlock(membership);
        const updatedAt =
          normalizeTimestamp(membership['updatedAt'])
          ?? normalizeTimestamp(membership['joinedAt'])
          ?? normalizeTimestamp(membership['blockedAt'])
          ?? Date.now();

        if (
          memberStatus !== status
          || !role
          || !membershipMatchesManagementRoleFilter(
            membership,
            status,
            roleFilter
          )
        ) {
          return null;
        }

        return {
          memberId,
          label:
            normalizeText(projection['label'], 60)
            || 'Participante',
          avatarUrl: normalizeHttpsUrl(projection['avatarUrl']),
          status: memberStatus,
          role,
          roleBeforeBlock:
            previousRole === 'admin'
            || previousRole === 'moderator'
            || previousRole === 'member'
              ? previousRole
              : null,
          updatedAt,
          capabilities: buildCapabilities(
            actorUid,
            actor,
            memberId,
            membership,
            community
          ),
        };
      })
      .filter((item): item is CommunityManagedMemberItem => item !== null);

    const hasMore = indexSnapshot.docs.length > limit;
    const lastDocument = pageDocuments.at(-1) ?? null;
    const lastSortLabel = String(lastDocument?.data()?.['sortLabel'] ?? '').trim();

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

    const commandStartedAtMs = Date.now();

    return db.runTransaction(async (transaction) => {
      const communityRef = db.collection('communities').doc(communityId);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const targetMembershipRef = communityRef.collection('members').doc(memberId);
      const actorUserRef = db.collection('users').doc(actorUid);
      const targetUserRef = db.collection('users').doc(memberId);
      const actorAgeEligibilityRef = db
        .collection('age_eligibility_records')
        .doc(actorUid);
      const auditRef = db.collection('community_membership_audit').doc();
      const [
        communitySnapshot,
        discoverySnapshot,
        actorMembershipSnapshot,
        targetMembershipSnapshot,
        actorUserSnapshot,
        actorAgeEligibilitySnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(discoveryRef),
        transaction.get(actorMembershipRef),
        transaction.get(targetMembershipRef),
        transaction.get(actorUserRef),
        transaction.get(actorAgeEligibilityRef),
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
        actorUid,
        actorAgeEligibilitySnapshot.exists
          ? actorAgeEligibilitySnapshot.data()
          : null
      );
      const community = communitySnapshot.data() ?? {};
      assertCommunityManageable(community);

      const actorMembership = actorMembershipSnapshot.exists
        ? actorMembershipSnapshot.data() ?? {}
        : {};
      const targetMembership = targetMembershipSnapshot.exists
        ? targetMembershipSnapshot.data() ?? {}
        : {};
      const actor = assertManagerMembership(
        community,
        actorUid,
        actorMembership
      );
      const currentTargetRole = resolveCanonicalCommunityMemberRole(
        community,
        memberId,
        normalizeMembershipRole(targetMembership['role'])
      );
      const targetRoleBeforeBlock = roleBeforeBlock(targetMembership);
      const targetBlockedByRole = blockerRole(targetMembership);
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

      const requiresRecentAuthentication =
        nextRole === 'admin'
        || currentTargetRole === 'admin'
        || targetRoleBeforeBlock === 'admin'
        || (
          action === 'set_role'
          && currentTargetRole === 'member'
          && nextRole === 'moderator'
        );

      if (requiresRecentAuthentication) {
        assertRecentAuthentication(
          (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
        );
      }

      const lifecycleNotificationAction:
        CommunityMemberLifecycleNotificationAction | null =
          action === 'remove' || action === 'block' || action === 'unblock'
            ? action
            : null;
      const requiresTargetEligibility =
        action === 'set_role'
        && (nextRole === 'admin' || nextRole === 'moderator');
      const targetUserSnapshot =
        lifecycleNotificationAction !== null || requiresTargetEligibility
          ? await transaction.get(targetUserRef)
          : null;

      if (requiresTargetEligibility) {
        await assertCommunityMembershipActorEligibleInTransaction(
          transaction,
          memberId,
          targetUserSnapshot?.exists
            ? targetUserSnapshot.data()
            : null
        );
      }

      const targetUser = targetUserSnapshot?.data() as
        | CommunityNotificationUser
        | undefined;
      const shouldNotifyTarget =
        lifecycleNotificationAction !== null
        && targetUserSnapshot?.exists === true
        && canReceiveCommunityEssentialNotification(
          targetUser,
          memberId,
          actorUid
        );
      const lifecycleCycleStartedAtMs = action === 'unblock'
        ? normalizeTimestamp(targetMembership['blockedAt'])
          ?? normalizeTimestamp(targetMembership['updatedAt'])
          ?? commandStartedAtMs
        : normalizeTimestamp(targetMembership['joinedAt'])
          ?? normalizeTimestamp(targetMembership['updatedAt'])
          ?? commandStartedAtMs;

      const losesBoostAuthority =
        currentTargetRole === 'admin'
        && (
          decision.targetNextStatus !== 'active'
          || decision.targetNextRole !== 'admin'
        );

      if (!decision.idempotent && losesBoostAuthority) {
        await stopOpenCommunityBoostForCommunityInTransaction({
          transaction,
          communityId,
          reason: 'advertiser_authority_lost',
          now: commandStartedAtMs,
          actorUid,
          expectedAdvertiserUid: memberId,
        });
      }

      const nextMemberCount = decision.decrementMemberCount
        ? resolveMemberCountDelta(community, -1)
        : null;

      if (decision.decrementMemberCount && nextMemberCount === null) {
        throw new HttpsError(
          'data-loss',
          'A contagem de participantes desta Comunidade está inconsistente.'
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

        syncCommunityUserIndexInTransaction({
          transaction,
          communityId,
          memberId,
          community,
          membership: {
            role: decision.targetNextRole,
            status: decision.targetNextStatus,
          },
          updatedAt: now,
        });

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

        if (
          lifecycleNotificationAction
          && shouldNotifyTarget
        ) {
          const notificationRef = db
            .collection('notifications')
            .doc(buildCommunityMemberLifecycleNotificationId(
              communityId,
              memberId,
              lifecycleCycleStartedAtMs,
              lifecycleNotificationAction
            ));
          const copy = buildCommunityMemberLifecycleNotificationCopy({
            action: lifecycleNotificationAction,
            communityName: community['name'],
          });
          const route = lifecycleNotificationAction === 'block'
            ? '/dashboard/comunidades'
            : buildCommunityNotificationRoute(communityId);
          let notificationType = 'community.membership.unblocked';
          if (lifecycleNotificationAction === 'remove') {
            notificationType = 'community.membership.removed';
          } else if (lifecycleNotificationAction === 'block') {
            notificationType = 'community.membership.blocked';
          }

          transaction.set(notificationRef, {
            userId: memberId,
            type: notificationType,
            title: copy.title,
            body: copy.body,
            route,
            communityId,
            actorUid,
            readAt: null,
            createdAt: now,
            updatedAt: now,
          }, { merge: true });
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
