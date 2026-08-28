// functions/src/auth/onUserCreate.ts
import { auth as authTrigger } from 'firebase-functions/v1';

import { db } from '../firebaseApp';
import { buildInitialUserSeed } from './user-registration-seed';

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

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(userRef);

    if (existing.exists) {
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
