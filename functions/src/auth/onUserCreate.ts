// functions/src/auth/onUserCreate.ts
import { auth as authTrigger } from 'firebase-functions/v1';

import { db, FieldValue } from '../firebaseApp';

const INITIAL_TERMS_VERSION = 'v1';

/**
 * Cria somente o seed privado mínimo e canônico da conta.
 *
 * Regras de concorrência:
 * - se o fluxo web já criou users/{uid}, esta trigger não altera o documento;
 * - se a trigger criar primeiro, o bootstrap de e-mail ou social pode completar
 *   os dados depois com merge;
 * - nunca rebaixa aceite de termos, nickname ou outros dados já persistidos.
 */
export const onUserCreate = authTrigger.user().onCreate(async (user) => {
  const userRef = db.collection('users').doc(user.uid);
  const now = FieldValue.serverTimestamp();
  const nowMs = Date.now();

  const authProviders = Array.from(
    new Set(
      (user.providerData ?? [])
        .map((provider) => String(provider?.providerId ?? '').trim())
        .filter(Boolean)
    )
  );

  const lastProvider = authProviders[0] ?? null;
  const photoURL = String(user.photoURL ?? '').trim();

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(userRef);

    if (existing.exists) {
      return;
    }

    transaction.create(userRef, {
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
    });
  });
});
