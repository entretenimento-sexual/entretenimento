import type { UserRecord } from 'firebase-admin/auth';

import { FieldValue } from 'firebase-admin/firestore';
import { generatePublicProfileId } from '../identity/public-profile-id';
import { resolveRegistrationAuthProgress } from '../registration/registration-auth-progress.policy';

export const INITIAL_TERMS_VERSION = 'v1';
export const REGISTRATION_FLOW_VERSION = 'v3-private-by-default';

export interface InitialUserSeedOptions {
  nowMs?: number;
  source?: 'auth-trigger' | 'registration-recovery';
}

export function buildRegistrationAuthProjection(user: UserRecord) {
  const authProviders = Array.from(
    new Set(
      (user.providerData ?? [])
        .map((provider) => String(provider?.providerId ?? '').trim())
        .filter(Boolean)
    )
  );

  const lastProvider = authProviders[0] ?? null;
  return { emailVerified: user.emailVerified === true, authProviders, lastProvider };
}

export function buildInitialUserSeed(
  user: UserRecord,
  options: InitialUserSeedOptions = {}
): Record<string, unknown> {
  const now = FieldValue.serverTimestamp();
  const nowMs = Number.isFinite(options.nowMs)
    ? Number(options.nowMs)
    : Date.now();

  const photoURL = String(user.photoURL ?? '').trim();

  return {
    uid: user.uid,
    profileId: generatePublicProfileId(),
    email: user.email ?? null,
    nickname: '',
    ...(photoURL ? { photoURL } : {}),

    role: 'free',
    tier: 'free',

    ...buildRegistrationAuthProjection(user),
    isSubscriber: false,
    subscriptionStatus: 'inactive',
    accountStatus: 'active',
    profileCompleted: false,
    registrationFlowVersion: REGISTRATION_FLOW_VERSION,
    registrationAuthProgress: resolveRegistrationAuthProgress(undefined, user, nowMs),
    registrationCompletedAt: null,

    acceptedTerms: {
      accepted: false,
      date: null,
      version: INITIAL_TERMS_VERSION,
      acceptedAt: null,
      updatedAt: now,
      source: 'system',
    },

    roles: ['user'],
    permissions: [],
    entitlements: [],

    suspended: false,
    accountLocked: false,
    publicVisibility: 'hidden',
    interactionBlocked: true,
    loginAllowed: true,

    firstLogin: now,
    registrationDate: now,
    lastLogin: now,
    createdAt: now,
    updatedAt: now,
    updatedAtMs: nowMs,
    registrationSeedSource: options.source ?? 'auth-trigger',
  };
}
