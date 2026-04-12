// src/app/account/models/account-lifecycle.model.ts

export type AccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type AccountLifecycleSource =
  | 'self'
  | 'moderator'
  | 'system'
  | null;

  export type AccountLifecycleDialogIntent =
  | 'self_suspend'
  | 'self_delete'
  | 'reactivate_self_suspend'
  | 'cancel_pending_deletion'
  | 'moderator_suspend'
  | 'moderator_delete';

export interface AccountLifecycleDialogConfirmEvent {
  intent: AccountLifecycleDialogIntent;
  reason?: string | null;
}

export interface AccountLifecycleState {
  accountStatus: AccountStatus;

  publicVisibility: 'visible' | 'hidden';
  interactionBlocked: boolean;
  loginAllowed: boolean;

  statusUpdatedAt: number | null;
  statusUpdatedBy: string | AccountLifecycleSource;

  suspensionReason: string | null;
  suspensionSource: 'self' | 'moderator' | null;
  suspensionEndsAt: number | null;

  deletionRequestedAt: number | null;
  deletionRequestedBy: 'self' | 'moderator' | null;
  deletionUndoUntil: number | null;
  purgeAfter: number | null;
  deletedAt: number | null;
}

export interface AccountStatusVm {
  title: string;
  description: string;
  badgeLabel: string;

  isBlocked: boolean;
  canReactivateSelfSuspension: boolean;
  canCancelDeletion: boolean;
  canGoToAccountHome: boolean;

  suspensionReason: string | null;
  suspensionEndsAt: number | null;

  deletionUndoUntil: number | null;
  purgeAfter: number | null;
}

export const DEFAULT_ACCOUNT_LIFECYCLE_STATE: AccountLifecycleState = {
  accountStatus: 'active',

  publicVisibility: 'visible',
  interactionBlocked: false,
  loginAllowed: true,

  statusUpdatedAt: null,
  statusUpdatedBy: null,

  suspensionReason: null,
  suspensionSource: null,
  suspensionEndsAt: null,

  deletionRequestedAt: null,
  deletionRequestedBy: null,
  deletionUndoUntil: null,
  purgeAfter: null,
  deletedAt: null,
};