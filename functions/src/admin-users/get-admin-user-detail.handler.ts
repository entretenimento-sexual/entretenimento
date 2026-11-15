import { FieldPath } from 'firebase-admin/firestore';
import {
  HttpsError,
  onCall,
} from 'firebase-functions/v2/https';

import {
  assertStaffAuthorization,
} from '../account_lifecycle/_shared';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

import {
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';

import {
  buildAdminUsersPage,
  type AdminUserRow,
} from './admin-users-page.policy';

import {
  parseAdminUserDetailRequest,
} from './admin-user-detail.policy';

export const getAdminUserDetail = onCall<unknown>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<AdminUserRow | null> => {
    assertCallableAppCheck(request.app);

    // Recheck current staff state, never trust old role claims.
    await assertStaffAuthorization({
      actorUid: request.auth?.uid ?? null,
      authToken: request.auth?.token ?? {},
      requiredPermission: 'users:suspend',
    });

    const input = parseAdminUserDetailRequest(
      request.data
    );

    if (!input) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid administrative user detail request.'
      );
    }

    // Server-side field projection. No full private
    // registration/payment document is sent to the client.
    const snapshot = await db.collection('users')
      .where(
        FieldPath.documentId(),
        '==',
        input.uid
      )
      .select(
        'nickname',
        'profileCompleted',
        'accountStatus',
        'suspended',
        'accountLocked',
        'interactionBlocked',
        'loginAllowed'
      )
      .limit(1)
      .get();

    const doc = snapshot.docs[0];

    if (!doc) {
      return null;
    }

    // Reuse the exact canonical sanitizer used
    // by the administrative list.
    const projected = buildAdminUsersPage(
      [{
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
      }],
      1
    );

    return projected.items[0] ?? null;
  }
);
