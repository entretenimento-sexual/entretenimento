import { Filter } from 'firebase-admin/firestore';
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
  buildAdminUserOverview,
  type AdminUserOverview,
} from './admin-user-overview.policy';

export const getAdminUserOverview = onCall<unknown>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<AdminUserOverview> => {
    assertCallableAppCheck(request.app);

    await assertStaffAuthorization({
      actorUid: request.auth?.uid ?? null,
      requiredPermission: 'users:suspend',
    });

    const input = request.data;

    if (
      input !== undefined &&
      input !== null &&
      (
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length !== 0
      )
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid administrative summary request.'
      );
    }

    const users = db.collection('users');

    // Aggregation queries return counts, never user documents.
    // OR filters count each matching document only once.
    const queries = [
      users,
      users.where('profileCompleted', '==', true),
      users.where(Filter.or(
        Filter.where('suspended', '==', true),
        Filter.where('accountLocked', '==', true),
        Filter.where('interactionBlocked', '==', true),
        Filter.where(
          'accountStatus',
          'in',
          [
            'self_suspended',
            'moderation_suspended',
            'pending_deletion',
          ]
        )
      )),
      users.where('isOnline', '==', true),
      users.where(Filter.or(
        Filter.where('isSubscriber', '==', true),
        Filter.where('subscriptionStatus', '==', 'active'),
        Filter.where('role', 'in', ['premium', 'vip'])
      )),
    ];

    const snapshots = await Promise.all(
      queries.map(query => query.count().get())
    );

    const [
      totalUsers,
      completedProfiles,
      restrictedUsers,
      onlineUsers,
      subscribers,
    ] = snapshots.map(snapshot => snapshot.data().count);

    try {
      return buildAdminUserOverview({
        totalUsers,
        completedProfiles,
        restrictedUsers,
        onlineUsers,
        subscribers,
      });
    } catch {
      throw new HttpsError(
        'internal',
        'Administrative aggregates unavailable.'
      );
    }
  }
);
