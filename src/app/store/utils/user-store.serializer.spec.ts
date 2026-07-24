import { sanitizeUserForStore } from './user-store.serializer';

describe('sanitizeUserForStore', () => {
  it('deve converter mediaMetricsUpdatedAt do Firestore para epoch serializável', () => {
    const source = {
      uid: 'user-1',
      lastLogin: 0,
      mediaMetricsUpdatedAt: {
        toMillis: () => 1_721_234_567_890,
      },
    } as any;

    const result = sanitizeUserForStore(source) as any;

    expect(result.mediaMetricsUpdatedAt).toBe(1_721_234_567_890);
    expect(typeof result.mediaMetricsUpdatedAt).toBe('number');
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('deve preservar epoch numérico e normalizar valor inválido para null', () => {
    const valid = sanitizeUserForStore({
      uid: 'user-1',
      lastLogin: 0,
      mediaMetricsUpdatedAt: 1_700_000_000_000,
    } as any) as any;

    const invalid = sanitizeUserForStore({
      uid: 'user-2',
      lastLogin: 0,
      mediaMetricsUpdatedAt: { unexpected: true },
    } as any) as any;

    expect(valid.mediaMetricsUpdatedAt).toBe(1_700_000_000_000);
    expect(invalid.mediaMetricsUpdatedAt).toBeNull();
  });
});
