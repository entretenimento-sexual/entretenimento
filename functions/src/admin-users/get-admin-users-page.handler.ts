import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertStaffAuthorization
} from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertCallableAppCheck
} from '../shared/security/callable-app-check';

import {
  buildAdminUsersPage,
  parseAdminUsersPageRequest,
  type AdminUsersPageResponse
} from './admin-users-page.policy';

export const getAdminUsersPage = onCall<unknown>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<AdminUsersPageResponse> => {
    assertCallableAppCheck(request.app);

    await assertStaffAuthorization({
      actorUid: request.auth?.uid ?? null,
      authToken: request.auth?.token ?? {},
      requiredPermission: 'users:suspend'
    });

    const input = parseAdminUsersPageRequest(request.data);

    if (!input) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid administrative page request.'
      );
    }

    let query = db.collection('users')
      .orderBy(FieldPath.documentId(), 'asc')
      .select(
        'nickname',
        'profileCompleted',
        'accountStatus',
        'suspended',
        'accountLocked',
        'interactionBlocked',
        'loginAllowed'
      )
      .limit(input.limit + 1);

    if (input.cursor) {
      query = query.startAfter(input.cursor);
    }

    const snapshot = await query.get();

    return buildAdminUsersPage(
      snapshot.docs.map(document => ({
        id: document.id,
        data: document.data() as Record<string, unknown>
      })),
      input.limit
    );
  }
);
