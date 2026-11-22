import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { REGISTRATION_FLOW_VERSION } from '../auth/user-registration-seed';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { auth, db, FieldValue } from '../firebaseApp';
import { resolveRegistrationAuthProgress } from './registration-auth-progress.policy';

export async function recordRegistrationAuthProgress(uid: string): Promise<void> {
  const ref = db.doc(`users/${uid}`);
  await db.runTransaction(async tx => {
    const account = (await tx.get(ref)).data();
    if (account?.profileCompleted !== false || account.uid !== uid ||
        account.registrationFlowVersion !== REGISTRATION_FLOW_VERSION) return;

    const user = await auth.getUser(uid).catch((error: { code?: string }) => {
      if (error.code === 'auth/user-not-found') return null;
      throw error;
    });
    if (!user?.email || user.disabled || (account.email != null && account.email !== user.email)) return;

    const progress = resolveRegistrationAuthProgress(account, user, Date.now());
    if (progress === account.registrationAuthProgress) return;

    const marker = account.registrationAbandonment;
    tx.update(ref, {
      registrationAuthProgress: progress,
      ...(marker && progress.observedAtMs > marker.activityAtMs
        ? { registrationAbandonment: FieldValue.delete() } : {}),
    });
  });
}

export const onRegistrationEmailVerificationChanged = onDocumentUpdated(
  { document: 'users/{uid}', region: FUNCTIONS_REGION },
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (after?.profileCompleted !== false || before?.emailVerified === after.emailVerified) return;
    await recordRegistrationAuthProgress(event.params.uid);
  },
);
