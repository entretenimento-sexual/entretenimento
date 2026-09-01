// functions/src/auth/onUserCreate.ts
import { auth as authTrigger } from 'firebase-functions/v1';

import { db } from '../firebaseApp';
import {
  generatePublicProfileId,
  normalizePublicProfileId,
} from '../identity/public-profile-id';
import { buildInitialUserSeed } from './user-registration-seed';

/**
 * Garante o seed privado mínimo e o identificador público canônico da conta.
 *
 * Regras de concorrência:
 * - se o fluxo web já criou users/{uid}, a trigger preserva todos os campos e
 *   preenche apenas `profileId` quando ele estiver ausente ou inválido;
 * - se a trigger criar primeiro, o bootstrap de e-mail ou social pode completar
 *   os dados depois com merge;
 * - nunca rebaixa aceite de termos, nickname ou outros dados já persistidos.
 */
export const onUserCreate = authTrigger.user().onCreate(async (user) => {
  const userRef = db.collection('users').doc(user.uid);

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(userRef);

    if (existing.exists) {
      const profileId = normalizePublicProfileId(
        existing.data()?.['profileId']
      );

      if (!profileId) {
        transaction.update(userRef, {
          profileId: generatePublicProfileId(),
        });
      }

      return;
    }

    transaction.create(
      userRef,
      buildInitialUserSeed(user, {
        source: 'auth-trigger',
      })
    );
  });
});
