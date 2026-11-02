import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertStaffAuthorization } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import {
  parseProfileIdentityCursor, projectIdentityReviewItem,
  type ProfileIdentityReviewCursor, type ProfileIdentityReviewItem,
} from './profile-identity-review-queue.policy';

const PAGE_SIZE = 25;

/** Fila estritamente administrativa; nunca retorna email ou histórico privado. */
export const getProfileIdentityReviewQueue = onCall<{ cursor?: unknown }>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    items: ProfileIdentityReviewItem[];
    nextCursor: ProfileIdentityReviewCursor | null;
  }> => {
    assertCallableAppCheck(request.app);
    await assertStaffAuthorization({
      actorUid: request.auth?.uid ?? null,
      authToken: request.auth?.token ?? {},
      requiredPermission: 'users:suspend',
    });
    const rawCursor = request.data?.cursor;
    const cursor = parseProfileIdentityCursor(rawCursor);
    if (rawCursor != null && !cursor) {
      throw new HttpsError('invalid-argument', 'Cursor da fila inválido.');
    }

    let query = db.collection('profile_identity_change_requests')
      .where('status', '==', 'PENDING')
      .orderBy('requestedAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PAGE_SIZE + 1);
    if (cursor) query = query.startAfter(cursor.requestedAt, cursor.uid);

    const snapshot = await query.get();
    const pageDocs = snapshot.docs.slice(0, PAGE_SIZE);
    const items = pageDocs
      .map((doc) => projectIdentityReviewItem(
        doc.id, (doc.data() ?? {}) as Record<string, unknown>
      ))
      .filter((item): item is ProfileIdentityReviewItem => item !== null);
    const last = pageDocs.at(-1);
    const nextCursor = snapshot.docs.length > PAGE_SIZE && last
      ? { requestedAt: Number(last.get('requestedAt')), uid: last.id }
      : null;
    return { items, nextCursor };
  }
);
