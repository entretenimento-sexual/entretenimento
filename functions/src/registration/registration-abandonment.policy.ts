import type { UserRecord } from 'firebase-admin/auth';
import { REGISTRATION_FLOW_VERSION } from '../auth/user-registration-seed';
import { hasAcceptedCurrentTerms } from '../compliance/platform-legal.constants';
import {
  REGISTRATION_EMAIL_LINK_UID_PREFIX,
  resolveRegistrationAuthProgress,
  type RegistrationAuthProgress,
} from './registration-auth-progress.policy';

const DAY_MS = 86_400_000;
export const REGISTRATION_RESUME_WINDOW_MS = 7 * DAY_MS;
export const REGISTRATION_EMAIL_LINK_DRAFTS = 'registration_email_link_drafts';
export const REGISTRATION_INACTIVITY_DAYS = {
  emailPending: 7,
  passwordPending: 7,
  termsPending: 30,
  profilePending: 90,
} as const;
type Stage = keyof typeof REGISTRATION_INACTIVITY_DAYS;
type RegistrationAuth = Pick<UserRecord, 'uid' | 'email' | 'emailVerified' | 'passwordHash' | 'disabled'> & {
  metadata: Pick<UserRecord['metadata'], 'creationTime' | 'lastSignInTime' | 'lastRefreshTime'>;
};
const KNOWN_AGE_STATES = new Set(['UNVERIFIED', 'SELF_DECLARED_ADULT', 'VERIFIED_ADULT', 'EXPIRED']);

export type AbandonmentAssessment =
  | { kind: 'protected' | 'unclassified' }
  | { kind: 'active' | 'candidate'; stage: Stage; activityAtMs: number; authProgress: RegistrationAuthProgress };

export interface RegistrationAbandonment {
  stage: Stage;
  activityAtMs: number;
  flaggedAtMs: number;
  reviewAfterMs: number;
  status: 'resume_window' | 'review_ready';
}

function millis(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  const timestamp = value as { toMillis?: () => number } | null | undefined;
  return typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : NaN;
}

export function assessRegistrationAbandonment(
  uid: string,
  account: FirebaseFirestore.DocumentData | undefined,
  auth: RegistrationAuth | undefined,
  age: FirebaseFirestore.DocumentData | undefined,
  hasPublicProfile: boolean,
  nowMs: number,
): AbandonmentAssessment {
  if (!account || account.profileCompleted !== false) return { kind: 'unclassified' };
  const subscription = account.subscriptionStatus;
  if (hasPublicProfile || account.accountStatus !== 'active' ||
      account.accountLocked === true || account.suspended === true ||
      account.loginAllowed === false || account.registrationCompletedAt != null ||
      account.deletionRequestedAt != null || account.deletedAt != null ||
      account.ageReverificationRestrictedAt != null || account.moderationAutomationHold?.active === true ||
      account.legalHold === true || account.billingHold === true || auth?.disabled ||
      account.isSubscriber === true || (subscription != null && subscription !== 'inactive') ||
      account.currentSubscriptionId || account.entitlements?.length ||
      (account.ageReverification?.status && account.ageReverification.status !== 'NONE') ||
      ['REVIEW_REQUIRED', 'DENIED_UNDERAGE'].includes(age?.status)) {
    return { kind: 'protected' };
  }
  if (!auth || auth.uid !== uid || !auth.email || account.uid !== uid ||
      (account.email != null && account.email !== auth.email) ||
      (age && (age.uid !== uid || !KNOWN_AGE_STATES.has(age.status))) ||
      account.registrationFlowVersion !== REGISTRATION_FLOW_VERSION ||
      account.publicVisibility !== 'hidden' || account.interactionBlocked !== true || account.loginAllowed !== true) {
    return { kind: 'unclassified' };
  }

  // A renovação automática de token não significa que a pessoa retomou o cadastro.
  const authProgress = resolveRegistrationAuthProgress(account, auth, nowMs);
  const dates = [
    auth.metadata.creationTime, account.createdAt, auth.metadata.lastSignInTime,
    account.acceptedTerms?.acceptedAt, account.acceptedTerms?.date,
    account.nicknameHistory?.[0]?.date, age?.decidedAtMs, authProgress.observedAtMs,
  ];
  const present = dates.filter((date, index) => index < 2 || date != null).map(millis);
  if (present.some(date => !Number.isFinite(date) || date <= 0 || date > nowMs)) {
    return { kind: 'unclassified' };
  }
  const stage = authProgress.stage !== 'credentialsReady' ? authProgress.stage
    : !hasAcceptedCurrentTerms(account.acceptedTerms) ? 'termsPending' : 'profilePending';
  const activityAtMs = Math.max(...present);
  const kind = nowMs - activityAtMs >= REGISTRATION_INACTIVITY_DAYS[stage] * DAY_MS ? 'candidate' : 'active';
  return { kind, stage, activityAtMs, authProgress };
}

export function nextRegistrationAbandonment(
  assessment: AbandonmentAssessment,
  previous: RegistrationAbandonment | undefined,
  nowMs: number,
): RegistrationAbandonment | undefined {
  if (assessment.kind !== 'candidate') return undefined;
  const { stage, activityAtMs } = assessment;
  if (previous?.stage === stage && previous.activityAtMs === activityAtMs &&
      Number.isSafeInteger(previous.flaggedAtMs) && previous.flaggedAtMs >= activityAtMs &&
      previous.flaggedAtMs <= nowMs &&
      previous.reviewAfterMs === previous.flaggedAtMs + REGISTRATION_RESUME_WINDOW_MS) {
    const status = nowMs >= previous.reviewAfterMs ? 'review_ready' : 'resume_window';
    return status === previous.status ? previous : { ...previous, status };
  }
  return {
    stage, activityAtMs, flaggedAtMs: nowMs,
    reviewAfterMs: nowMs + REGISTRATION_RESUME_WINDOW_MS, status: 'resume_window',
  };
}

export function classifyRegistrationDraft(
  id: string, data: FirebaseFirestore.DocumentData, nowMs: number,
): 'accountReceipts' | 'expiredDrafts' | 'validDrafts' | 'unclassified' {
  if (id.startsWith(REGISTRATION_EMAIL_LINK_UID_PREFIX) || 'oobCodeHash' in data ||
      'adultDeclaredAtMs' in data || 'adultDeclarationVersion' in data) return 'accountReceipts';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
      !Number.isSafeInteger(data.expiresAtMs) || data.expiresAtMs <= 0) return 'unclassified';
  return data.expiresAtMs <= nowMs ? 'expiredDrafts' : 'validDrafts';
}
