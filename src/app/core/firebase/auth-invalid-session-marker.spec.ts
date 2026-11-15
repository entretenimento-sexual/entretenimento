import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthInvalidUid, hasAuthInvalidUid, markAuthInvalidUid } from './auth-invalid-session-marker';

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('auth invalid session marker', () => {
  it('persiste bloqueio apenas para o UID correspondente', () => {
    markAuthInvalidUid('user-a');
    expect(hasAuthInvalidUid('user-a')).toBe(true);
    expect(hasAuthInvalidUid('user-b')).toBe(false);
    clearAuthInvalidUid('user-a');
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

  it('nao falha quando storage esta indisponivel', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => markAuthInvalidUid('user-a')).not.toThrow();
    expect(hasAuthInvalidUid('user-a')).toBe(false);
    expect(() => clearAuthInvalidUid('user-a')).not.toThrow();
  });
});
