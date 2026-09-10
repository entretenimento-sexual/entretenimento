// functions/src/community/update-community-notification-preference.handler.ts
// -----------------------------------------------------------------------------
// UPDATE COMMUNITY NOTIFICATION PREFERENCE
// -----------------------------------------------------------------------------
// Mute é preferência do próprio usuário e afeta apenas interrupções/push.
// A Central in-app e seus contadores continuam completos. O documento é esparso:
// `muted=true` existe; desmutar remove o documento.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';

interface UpdateCommunityNotificationPreferenceRequest {
  communityId?: unknown;
  muted?: unknown;
}

interface UpdateCommunityNotificationPreferenceResponse {
  communityId: string;
  muted: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertAuthenticatedUid(auth: { uid?: string } | undefined): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Usuário não autenticado.',
      { reason: 'authentication_required' }
    );
  }
  return uid;
}

export const updateCommunityNotificationPreference =
  onCall<UpdateCommunityNotificationPreferenceRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<UpdateCommunityNotificationPreferenceResponse> => {
      assertCommunityCallableAppCheck(request.app);
      const uid = assertAuthenticatedUid(request.auth);
      const communityId = String(request.data?.communityId ?? '').trim();
      const muted = request.data?.muted;

      if (!SAFE_ID_PATTERN.test(communityId) || typeof muted !== 'boolean') {
        throw new HttpsError(
          'invalid-argument',
          'Preferência de Comunidade inválida.',
          { reason: 'invalid_community_notification_preference' }
        );
      }

      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(uid);
      const preferenceRef = db
        .collection('community_notification_preferences')
        .doc(uid)
        .collection('items')
        .doc(communityId);

      await db.runTransaction(async (transaction) => {
        const [communitySnapshot, membershipSnapshot] = await Promise.all([
          transaction.get(communityRef),
          transaction.get(membershipRef),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Comunidade não encontrada.',
            { reason: 'community_not_found' }
          );
        }

        if (
          !membershipSnapshot.exists
          || membershipSnapshot.data()?.['status'] !== 'active'
        ) {
          throw new HttpsError(
            'permission-denied',
            'Participe da Comunidade para alterar estas notificações.',
            { reason: 'active_membership_required' }
          );
        }

        if (muted) {
          transaction.set(preferenceRef, {
            userId: uid,
            communityId,
            muted: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          transaction.delete(preferenceRef);
        }
      });

      return { communityId, muted };
    }
  );
