import type { UserRecord } from 'firebase-admin/auth';

import { FieldValue } from '../firebaseApp';

export const INITIAL_TERMS_VERSION = 'v1';

export interface InitialUserSeedOptions {
  nowMs?: number;
  source?: 'auth-trigger' | 'registration-recovery';
}

export function buildInitialUserSeed(
  user: UserRecord,
  options: InitialUserSeedOptions = {}
): Record<string, unknown> {
  const now = FieldValue.serverTimestamp();
  const nowMs = Number.isFinite(options.nowMs)
    ? Number(options.nowMs)
    : Date.now();

  const authProviders = Array.from(
    new Set(
      (user.providerData ?? [])
        .map((provider) => String(provider?.providerId ?? '').trim())
        .filter(Boolean)
    )
  );

  const lastProvider = authProviders[0] ?? null;
  const photoURL = String(user.photoURL ?? '').trim();

  return {
    uid: user.uid,
    email: user.email ?? null,
    nickname: '',
    ...(photoURL ? { photoURL } : {}),

    role: 'free',
    tier: 'free',

    emailVerified: user.emailVerified === true,
    isSubscriber: false,
    subscriptionStatus: 'inactive',
    accountStatus: 'active',
    profileCompleted: false,

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
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,

    authProviders,
    lastProvider,

    firstLogin: now,
    registrationDate: now,
    lastLogin: now,
    createdAt: now,
    updatedAt: now,
    updatedAtMs: nowMs,
    registrationSeedSource: options.source ?? 'auth-trigger',
  };
}
