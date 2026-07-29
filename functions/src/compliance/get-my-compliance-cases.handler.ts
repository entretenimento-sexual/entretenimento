import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

function toMillis(value: unknown): number | null {
  const timestamp = value as { toMillis?: () => number } | null | undefined;
  if (typeof timestamp?.toMillis === 'function') {
    const result = timestamp.toMillis();
    return Number.isFinite(result) ? result : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export const getMyComplianceCases = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    items: Array<Record<string, unknown>>;
  }> => {
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para consultar seus casos de conformidade.'
      );
    }

    const snapshot = await db
      .collection('compliance_cases')
      .where('targetUid', '==', uid)
      .limit(50)
      .get();

    const items = snapshot.docs
      .map((doc) => {
        const data = doc.data();

        return {
          caseId: doc.id,
          category: String(data.category ?? ''),
          summary: String(data.summary ?? ''),
          policySection: String(data.policySection ?? ''),
          preventiveMeasure:
            String(data.preventiveMeasure ?? '').trim() || null,
          status: String(data.status ?? ''),
          presumption: String(data.presumption ?? ''),
          responseDueAt: toMillis(data.responseDueAt),
          userResponse: String(data.userResponse ?? '').trim() || null,
          userRespondedAt: toMillis(data.userRespondedAt),
          resolution: String(data.resolution ?? '').trim() || null,
          resolvedAt: toMillis(data.resolvedAt),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      })
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .slice(0, 30);

    return { items };
  }
);
