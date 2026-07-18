// src/app/core/access/content-access-policy.service.ts
// -----------------------------------------------------------------------------
// CONTENT ACCESS POLICY SERVICE
// -----------------------------------------------------------------------------
// Avaliação reativa e determinística de acesso. O resultado orienta a UI, mas a
// autorização definitiva de dados e pagamentos continua no backend e nas Rules.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import {
  IUserDados,
  UserTierRole,
} from '../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../services/autentication/auth/current-user-store.service';
import {
  ContentAccessDecision,
  ContentAccessDenialReason,
  ContentAccessPolicy,
  ContentAccessProfileField,
  ContentAccessRecommendedAction,
} from './content-access-policy.model';

const ROLE_HIERARCHY: readonly UserTierRole[] = [
  'visitante',
  'free',
  'basic',
  'premium',
  'vip',
  'admin',
];

const AGE_REVERIFICATION_RESTRICTED_STATES = new Set([
  'REQUIRED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
]);

function denied(
  reason: ContentAccessDenialReason,
  recommendedAction: ContentAccessRecommendedAction,
  policy: ContentAccessPolicy,
  missingProfileFields: readonly ContentAccessProfileField[] = []
): ContentAccessDecision {
  return {
    allowed: false,
    reason,
    recommendedAction,
    minimumRole: policy.minimumRole ?? null,
    missingProfileFields,
  };
}

function allowed(policy: ContentAccessPolicy): ContentAccessDecision {
  return {
    allowed: true,
    reason: null,
    recommendedAction: null,
    minimumRole: policy.minimumRole ?? null,
    missingProfileFields: [],
  };
}

function normalizeRole(user: IUserDados): UserTierRole {
  const role = String(user.tier ?? user.role ?? 'visitante')
    .trim()
    .toLowerCase() as UserTierRole;

  return ROLE_HIERARCHY.includes(role) ? role : 'visitante';
}

function hasMinimumRole(user: IUserDados, policy: ContentAccessPolicy): boolean {
  if (!policy.minimumRole) {
    return true;
  }

  const userRoleIndex = ROLE_HIERARCHY.indexOf(normalizeRole(user));
  const minimumRoleIndex = ROLE_HIERARCHY.indexOf(policy.minimumRole);

  return userRoleIndex >= minimumRoleIndex;
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const maybeTimestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
  } | null | undefined;

  if (typeof maybeTimestamp?.toMillis === 'function') {
    const timestamp = maybeTimestamp.toMillis();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof maybeTimestamp?.toDate === 'function') {
    const timestamp = maybeTimestamp.toDate().getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
}

function hasActiveSubscription(user: IUserDados, nowMs: number): boolean {
  if (normalizeRole(user) === 'admin') {
    return true;
  }

  const subscriptionExpires = toMillis(user.subscriptionExpires);
  const statusAllowsAccess =
    user.subscriptionStatus == null || user.subscriptionStatus === 'active';
  const payerConfirmed = user.monthlyPayer === true || user.isSubscriber === true;

  return (
    statusAllowsAccess &&
    payerConfirmed &&
    subscriptionExpires !== null &&
    subscriptionExpires >= nowMs
  );
}

function isAccountRestricted(user: IUserDados): boolean {
  const accountUnavailable =
    user.accountStatus != null && user.accountStatus !== 'active';

  return (
    accountUnavailable ||
    user.suspended === true ||
    user.accountLocked === true ||
    user.interactionBlocked === true ||
    user.loginAllowed === false
  );
}

function hasAdultAccess(user: IUserDados): boolean {
  if (typeof user.idade === 'number' && user.idade < 18) {
    return false;
  }

  if (user.ageReverification?.result === 'UNDERAGE') {
    return false;
  }

  if (
    AGE_REVERIFICATION_RESTRICTED_STATES.has(
      String(user.ageReverification?.status ?? '')
    )
  ) {
    return false;
  }

  if (user.adultConsent?.accepted === false) {
    return false;
  }

  if (
    user.initialAdultConsentRequired === true &&
    user.adultConsent?.accepted !== true
  ) {
    return false;
  }

  return true;
}

function hasProfileField(
  user: IUserDados,
  field: ContentAccessProfileField
): boolean {
  const value = user[field];
  return typeof value === 'string' && value.trim().length > 0;
}

function findMissingProfileFields(
  user: IUserDados,
  fields: readonly ContentAccessProfileField[]
): readonly ContentAccessProfileField[] {
  return fields.filter((field) => !hasProfileField(user, field));
}

export function evaluateContentAccessPolicy(
  user: IUserDados | null | undefined,
  policy: ContentAccessPolicy,
  nowMs = Date.now()
): ContentAccessDecision {
  if (!user) {
    return denied('unauthenticated', 'sign_in', policy);
  }

  if (
    policy.blockRestrictedAccounts !== false &&
    isAccountRestricted(user)
  ) {
    return denied('account_restricted', 'review_account', policy);
  }

  if (policy.requiresAdultAccess && !hasAdultAccess(user)) {
    return denied(
      'adult_access_required',
      'confirm_adult_access',
      policy
    );
  }

  if (policy.requiresCompletedProfile && user.profileCompleted !== true) {
    return denied('profile_incomplete', 'complete_profile', policy);
  }

  const missingProfileFields = findMissingProfileFields(
    user,
    policy.requiredProfileFields ?? []
  );

  if (missingProfileFields.length > 0) {
    return denied(
      'profile_field_missing',
      'complete_profile',
      policy,
      missingProfileFields
    );
  }

  if (!hasMinimumRole(user, policy)) {
    return denied(
      'role_insufficient',
      'upgrade_subscription',
      policy
    );
  }

  if (
    policy.requiresActiveSubscription &&
    !hasActiveSubscription(user, nowMs)
  ) {
    return denied(
      'subscription_inactive',
      'upgrade_subscription',
      policy
    );
  }

  return allowed(policy);
}

export function areContentAccessDecisionsEqual(
  previous: ContentAccessDecision,
  current: ContentAccessDecision
): boolean {
  return (
    previous.allowed === current.allowed &&
    previous.reason === current.reason &&
    previous.recommendedAction === current.recommendedAction &&
    previous.minimumRole === current.minimumRole &&
    previous.missingProfileFields.length === current.missingProfileFields.length &&
    previous.missingProfileFields.every(
      (field, index) => field === current.missingProfileFields[index]
    )
  );
}

@Injectable({ providedIn: 'root' })
export class ContentAccessPolicyService {
  private readonly currentUserStore = inject(CurrentUserStoreService);

  evaluate$(policy: ContentAccessPolicy): Observable<ContentAccessDecision> {
    return this.currentUserStore.user$.pipe(
      map((user) => evaluateContentAccessPolicy(user ?? null, policy)),
      distinctUntilChanged(areContentAccessDecisionsEqual),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  canAccess$(policy: ContentAccessPolicy): Observable<boolean> {
    return this.evaluate$(policy).pipe(
      map((decision) => decision.allowed),
      distinctUntilChanged()
    );
  }
}
