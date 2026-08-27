// functions/src/community/community-member-management.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER MANAGEMENT POLICY
// -----------------------------------------------------------------------------
// Política pura para gestão de membros ativos/bloqueados. O handler permanece
// responsável por autenticação, leituras canônicas, transação, métricas e auditoria.
// A propriedade nunca é alterada por este fluxo; isso permanece exclusivo do
// lifecycle de ownership.
// -----------------------------------------------------------------------------

export type CommunityManagedMemberStatus =
  | 'active'
  | 'pending'
  | 'blocked'
  | 'left'
  | null;

export type CommunityManagedMemberRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member'
  | null;

export type CommunityAssignableMemberRole = 'admin' | 'moderator' | 'member';

export type CommunityMemberManagementAction =
  | 'set_role'
  | 'remove'
  | 'block'
  | 'unblock';

export type CommunityMemberManagementDenialReason =
  | 'community_source_not_supported'
  | 'manager_required'
  | 'self_action_forbidden'
  | 'owner_protected'
  | 'target_unavailable'
  | 'role_change_forbidden'
  | 'action_forbidden';

export interface CommunityMemberManagementInput {
  sourceType: 'community' | 'venue' | null;
  actorUid: string;
  targetUid: string;
  actorStatus: CommunityManagedMemberStatus;
  actorRole: CommunityManagedMemberRole;
  targetStatus: CommunityManagedMemberStatus;
  targetRole: CommunityManagedMemberRole;
  targetRoleBeforeBlock?: CommunityManagedMemberRole;
  targetBlockedByActor?: boolean;
  targetBlockedByRole?: CommunityManagedMemberRole;
  action: CommunityMemberManagementAction;
  nextRole?: CommunityAssignableMemberRole | null;
}

export interface CommunityMemberManagementDecision {
  allowed: boolean;
  idempotent: boolean;
  denialReason: CommunityMemberManagementDenialReason | null;
  targetNextStatus: 'active' | 'blocked' | 'left' | null;
  targetNextRole: CommunityAssignableMemberRole | null;
  decrementMemberCount: boolean;
  auditAction:
    | 'community-member-role-changed'
    | 'community-member-removed'
    | 'community-member-blocked'
    | 'community-member-unblocked'
    | null;
}

function denied(
  denialReason: CommunityMemberManagementDenialReason
): CommunityMemberManagementDecision {
  return {
    allowed: false,
    idempotent: false,
    denialReason,
    targetNextStatus: null,
    targetNextRole: null,
    decrementMemberCount: false,
    auditAction: null,
  };
}

function actorCanManageTarget(
  actorRole: CommunityManagedMemberRole,
  targetRole: CommunityManagedMemberRole
): boolean {
  if (actorRole === 'owner') {
    return targetRole === 'admin' || targetRole === 'moderator' || targetRole === 'member';
  }

  if (actorRole === 'admin') {
    return targetRole === 'moderator' || targetRole === 'member';
  }

  return actorRole === 'moderator' && targetRole === 'member';
}

function actorCanAssignRole(
  actorRole: CommunityManagedMemberRole,
  targetRole: CommunityManagedMemberRole,
  nextRole: CommunityAssignableMemberRole | null
): boolean {
  if (!nextRole) return false;

  if (actorRole === 'owner') {
    return targetRole !== 'owner';
  }

  if (actorRole !== 'admin') return false;

  return (
    (targetRole === 'moderator' || targetRole === 'member')
    && (nextRole === 'moderator' || nextRole === 'member')
  );
}

function actorCanUnblock(
  actorRole: CommunityManagedMemberRole,
  roleBeforeBlock: CommunityManagedMemberRole,
  blockedByActor: boolean,
  blockedByRole: CommunityManagedMemberRole
): boolean {
  if (actorRole === 'owner') {
    return roleBeforeBlock !== 'owner';
  }

  if (actorRole === 'admin') {
    return (
      (roleBeforeBlock === 'moderator' || roleBeforeBlock === 'member')
      && blockedByRole !== 'owner'
      && blockedByRole !== null
    );
  }

  return actorRole === 'moderator'
    && roleBeforeBlock === 'member'
    && blockedByActor;
}

export function evaluateCommunityMemberManagement(
  input: Readonly<CommunityMemberManagementInput>
): Readonly<CommunityMemberManagementDecision> {
  if (input.sourceType !== 'community') {
    return denied('community_source_not_supported');
  }

  const actorCanManage =
    input.actorStatus === 'active'
    && (input.actorRole === 'owner'
      || input.actorRole === 'admin'
      || input.actorRole === 'moderator');

  if (!actorCanManage) {
    return denied('manager_required');
  }

  if (!input.actorUid || input.actorUid === input.targetUid) {
    return denied('self_action_forbidden');
  }

  if (input.targetRole === 'owner') {
    return denied('owner_protected');
  }

  if (input.action === 'set_role') {
    if (input.targetStatus !== 'active' || !input.targetRole) {
      return denied('target_unavailable');
    }

    const nextRole = input.nextRole ?? null;
    if (!actorCanAssignRole(input.actorRole, input.targetRole, nextRole)) {
      return denied('role_change_forbidden');
    }

    if (input.targetRole === nextRole) {
      return {
        allowed: true,
        idempotent: true,
        denialReason: null,
        targetNextStatus: 'active',
        targetNextRole: nextRole,
        decrementMemberCount: false,
        auditAction: null,
      };
    }

    return {
      allowed: true,
      idempotent: false,
      denialReason: null,
      targetNextStatus: 'active',
      targetNextRole: nextRole,
      decrementMemberCount: false,
      auditAction: 'community-member-role-changed',
    };
  }

  if (input.action === 'unblock') {
    if (input.targetStatus === 'left') {
      return {
        allowed: true,
        idempotent: true,
        denialReason: null,
        targetNextStatus: 'left',
        targetNextRole: 'member',
        decrementMemberCount: false,
        auditAction: null,
      };
    }

    if (input.targetStatus !== 'blocked') {
      return denied('target_unavailable');
    }

    const roleBeforeBlock = input.targetRoleBeforeBlock ?? null;
    if (!actorCanUnblock(
      input.actorRole,
      roleBeforeBlock,
      input.targetBlockedByActor === true,
      input.targetBlockedByRole ?? null
    )) {
      return denied('action_forbidden');
    }

    return {
      allowed: true,
      idempotent: false,
      denialReason: null,
      targetNextStatus: 'left',
      targetNextRole: 'member',
      decrementMemberCount: false,
      auditAction: 'community-member-unblocked',
    };
  }

  if (input.targetStatus !== 'active' || !input.targetRole) {
    if (input.action === 'remove' && input.targetStatus === 'left') {
      return {
        allowed: true,
        idempotent: true,
        denialReason: null,
        targetNextStatus: 'left',
        targetNextRole: 'member',
        decrementMemberCount: false,
        auditAction: null,
      };
    }

    if (input.action === 'block' && input.targetStatus === 'blocked') {
      return {
        allowed: true,
        idempotent: true,
        denialReason: null,
        targetNextStatus: 'blocked',
        targetNextRole: 'member',
        decrementMemberCount: false,
        auditAction: null,
      };
    }

    return denied('target_unavailable');
  }

  if (!actorCanManageTarget(input.actorRole, input.targetRole)) {
    return denied('action_forbidden');
  }

  if (input.action === 'remove') {
    return {
      allowed: true,
      idempotent: false,
      denialReason: null,
      targetNextStatus: 'left',
      targetNextRole: 'member',
      decrementMemberCount: true,
      auditAction: 'community-member-removed',
    };
  }

  if (input.action === 'block') {
    return {
      allowed: true,
      idempotent: false,
      denialReason: null,
      targetNextStatus: 'blocked',
      targetNextRole: 'member',
      decrementMemberCount: true,
      auditAction: 'community-member-blocked',
    };
  }

  return denied('action_forbidden');
}
