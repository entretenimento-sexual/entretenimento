import { describe, expect, it } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import {
  isResolvedAccountStatus,
  isRestrictedAccountStatus,
  normalizeAccountStatus,
  resolveAccountStatus,
} from './account-lifecycle-status.util';

function user(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'user-1',
    email: null,
    photoURL: null,
    role: 'free',
    lastLogin: 1,
    descricao: '',
    isSubscriber: false,
    ...overrides,
  } as IUserDados;
}

describe('account-lifecycle-status.util', () => {
  it('não transforma perfil ausente em conta ativa', () => {
    expect(normalizeAccountStatus(undefined)).toBe('unknown');
    expect(normalizeAccountStatus(null)).toBe('unknown');
    expect(isRestrictedAccountStatus('unknown')).toBe(true);
    expect(isResolvedAccountStatus('unknown')).toBe(false);
  });

  it('faz lock técnico prevalecer sobre accountStatus active', () => {
    expect(
      normalizeAccountStatus(user({ accountStatus: 'active', accountLocked: true }))
    ).toBe('locked');
    expect(isRestrictedAccountStatus('locked')).toBe(true);
  });

  it('faz suspensão técnica prevalecer sobre accountStatus active', () => {
    expect(
      normalizeAccountStatus(
        user({
          accountStatus: 'active',
          suspended: true,
          suspensionSource: 'self',
        })
      )
    ).toBe('self_suspended');
  });

  it('falha fechado para status não reconhecido', () => {
    expect(
      normalizeAccountStatus(
        user({ accountStatus: 'future_status' as IUserDados['accountStatus'] })
      )
    ).toBe('unknown');
  });

  it('mantém documento legado sem status como active quando não há flags restritivas', () => {
    expect(normalizeAccountStatus(user({ accountStatus: undefined }))).toBe(
      'active'
    );
  });

  it('exige coerência entre Auth e UID do perfil', () => {
    expect(
      resolveAccountStatus({
        authReady: true,
        authUid: 'auth-user',
        userResolved: true,
        user: user({ uid: 'other-user', accountStatus: 'active' }),
      })
    ).toBe('unknown');
  });
});
