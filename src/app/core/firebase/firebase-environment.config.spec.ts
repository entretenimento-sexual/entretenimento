import { describe, expect, it } from 'vitest';

import {
  normalizeFirebaseEmulatorEndpoint,
  resolveFirebaseAuthEmulatorPersistenceMode,
} from './firebase-environment.config';


describe('firebase-environment.config', () => {
  it('normaliza endpoint válido do emulator', () => {
    expect(
      normalizeFirebaseEmulatorEndpoint('auth', {
        host: ' 127.0.0.1 ',
        port: 9099,
      })
    ).toEqual({
      host: '127.0.0.1',
      port: 9099,
    });
  });

  it('retorna null quando o serviço não possui endpoint configurado', () => {
    expect(normalizeFirebaseEmulatorEndpoint('storage', undefined)).toBeNull();
  });

  it('rejeita host vazio para evitar conexão ambígua', () => {
    expect(() =>
      normalizeFirebaseEmulatorEndpoint('firestore', {
        host: '   ',
        port: 8080,
      })
    ).toThrowError('Host inválido');
  });

  it('rejeita porta fora do intervalo TCP válido', () => {
    expect(() =>
      normalizeFirebaseEmulatorEndpoint('functions', {
        host: '127.0.0.1',
        port: 70_000,
      })
    ).toThrowError('Porta inválida');
  });

  it('resolve persistência memory e usa session como fallback seguro', () => {
    expect(
      resolveFirebaseAuthEmulatorPersistenceMode({
        getItem: () => ' memory ',
      })
    ).toBe('memory');

    expect(
      resolveFirebaseAuthEmulatorPersistenceMode({
        getItem: () => {
          throw new Error('storage indisponível');
        },
      })
    ).toBe('session');
  });
});
