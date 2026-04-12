//functions\src\payments\application\get-my-billing-snapshot.handler.ts
import { db } from '../../firebaseApp';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

interface BillingSnapshotResponse {
  role?: string | null;
  tier?: string | null;
  isSubscriber?: boolean;
  entitlements?: string[];
  updatedAt?: number | null;
}

export const getMyBillingSnapshot = onCall<Record<string, never>>(
  async (request): Promise<BillingSnapshotResponse> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const [userSnap, entitlementsSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db
        .collection('entitlements')
        .where('buyerUid', '==', uid)
        .where('active', '==', true)
        .get(),
    ]);

    const user = userSnap.data() ?? {};

    const entitlements = entitlementsSnap.docs.map(
      (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = doc.data() ?? {};
        return String(data['scope'] ?? doc.id);
      }
    );

    return {
      role: (user['role'] as string | undefined) ?? null,
      tier: (user['tier'] as string | undefined) ?? null,
      isSubscriber: user['isSubscriber'] === true,
      entitlements,
      updatedAt: Number(user['billingUpdatedAt'] ?? Date.now()),
    };
  }
);