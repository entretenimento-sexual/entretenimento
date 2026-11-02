import { describe, expect, it } from 'vitest';
import { normalizeIdentityReviewPage } from './identity-review.model';

describe('identity review queue projection', () => {
  it('aceita somente itens pendentes tipados e cursor válido', () => {
    expect(normalizeIdentityReviewPage({
      items: [{ uid: 'u-1', currentIdentityCode: 'mulher',
        requestedIdentityCode: 'homem', requestedAt: 1760000000000,
        status: 'PENDING', structuralChange: false }],
      nextCursor: { uid: 'u-1', requestedAt: 1760000000000 },
    })).toMatchObject({ items: [{ uid: 'u-1' }] });
    expect(normalizeIdentityReviewPage({ items: [], nextCursor: null }))
      .toEqual({ items: [], nextCursor: null });
  });
  it('recusa resposta incompleta ou adulterada, sem mostrar histórico', () => {
    expect(normalizeIdentityReviewPage({ items: [
      { uid: '/bad', status: 'PENDING', requestedAt: 1 }
    ], nextCursor: null })).toBeNull();
    expect(normalizeIdentityReviewPage({ items: [], nextCursor: { uid: '/bad', requestedAt: 1 } })).toBeNull();
    const result = normalizeIdentityReviewPage({ items: [{
      uid: 'u-1', currentIdentityCode: 'mulher', requestedIdentityCode: 'homem',
      requestedAt: 1760000000000, status: 'PENDING',
      structuralChange: false, email: 'private@example.test',
    }], nextCursor: null });
    expect(result?.items[0]).not.toHaveProperty('email');
  });
});
