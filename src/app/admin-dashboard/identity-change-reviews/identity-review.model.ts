export interface IdentityReviewCursor {
  requestedAt: number;
  uid: string;
}

export interface IdentityReviewItem {
  uid: string;
  currentIdentityCode: string;
  requestedIdentityCode: string;
  requestedAt: number;
  status: 'PENDING';
  structuralChange: boolean;
}

export interface IdentityReviewPage {
  items: IdentityReviewItem[];
  nextCursor: IdentityReviewCursor | null;
}

const UID = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeIdentityReviewPage(raw: unknown): IdentityReviewPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input['items'])) return null;
  const items: IdentityReviewItem[] = [];
  for (const entry of input['items']) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (typeof item['uid'] !== 'string' || !UID.test(item['uid']) ||
        typeof item['currentIdentityCode'] !== 'string' ||
        typeof item['requestedIdentityCode'] !== 'string' ||
        !Number.isSafeInteger(item['requestedAt']) ||
        Number(item['requestedAt']) <= 0 ||
        item['status'] !== 'PENDING' || typeof item['structuralChange'] !== 'boolean') {
      return null;
    }
    items.push({
      uid: item['uid'], currentIdentityCode: item['currentIdentityCode'],
      requestedIdentityCode: item['requestedIdentityCode'],
      requestedAt: Number(item['requestedAt']),
      status: 'PENDING', structuralChange: item['structuralChange'],
    });
  }

  const rawCursor = input['nextCursor'];
  let nextCursor: IdentityReviewCursor | null = null;
  if (rawCursor !== null) {
    if (!rawCursor || typeof rawCursor !== 'object') return null;
    const cursor = rawCursor as Record<string, unknown>;
    if (!Number.isSafeInteger(cursor['requestedAt']) ||
        Number(cursor['requestedAt']) <= 0 ||
        typeof cursor['uid'] !== 'string' || !UID.test(cursor['uid'])) return null;
    nextCursor = {
      requestedAt: Number(cursor['requestedAt']), uid: cursor['uid'],
    };
  }
  return { items, nextCursor };
}
