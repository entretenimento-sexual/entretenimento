import { describe, expect, it } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import {
  isRuntimeAccountLifecycleBlocked,
  normalizeUserAccountLifecycleStatus,
  resolveRuntimeAccountLifecycleStatus,
} from './account-lifecycle.policy';

function user(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    role: 'free',
    lastLogin: 1,
    profileCompleted: true,
    isSubscriber: false,
    accountStatus: 'active',
    ...overrides,
  } as IUserDados;
}

describe('account lifecycle policy', () => {
  it('mantém guest confirmado fora do bloqueio de lifecycle', () => {
    const status = resolveRuntimeAccountLifecycleStatus({
      authReady: true,
      authUid: null,
      userResolved: true,
      user: null,
    });

    expect(status).toBe('active');
    expect(isRuntimeAccountLifecycleBlocked(status)).toBe(false);
  });

  it('falha fechado enquanto perfil autenticado ainda não foi hidratado', () => {
    const status = resolveRuntimeAccountLifecycleStatus({
      authReady: true,
      authUid: 'user-1',
      userResolved: false,
      user: undefined,
    });

    expect(status).toBe('unknown');
    expect(isRuntimeAccountLifecycleBlocked(status)).toBe(true);
  });

  it('falha fechado quando UID da sessão e do perfil divergem', () => {
    const status = resolveRuntimeAccountLifecycleStatus({
      authReady: true,
      authUid: 'user-1',
      userResolved: true,
      user: user({ uid: 'other-user' }),
    });

    expect(status).toBe('unknown');
    expect(isRuntimeAccountLifecycleBlocked(status)).toBe(true);
  });

  it('prioriza lock e suspensão sobre accountStatus ativo inconsistente', () => {
    expect(
      normalizeUserAccountLifecycleStatus(
        user({ accountStatus: 'active', accountLocked: true })
      )
    ).toBe('locked');

    expect(
      normalizeUserAccountLifecycleStatus(
        user({ accountStatus: 'active', suspended: true, suspensionSource: 'moderator' })
      )
    ).toBe('moderation_suspended');
  });

  it('trata status não reconhecido como unknown em vez de liberar a conta', () => {
    const status = normalizeUserAccountLifecycleStatus(
      user({ accountStatus: 'future_status' as any })
    );

    expect(status).toBe('unknown');
    expect(isRuntimeAccountLifecycleBlocked(status)).toBe(true);
  });

  it('preserva compatibilidade com documento legado sem accountStatus', () => {
    expect(
      normalizeUserAccountLifecycleStatus(
        user({ accountStatus: undefined, suspended: false, accountLocked: false })
      )
    ).toBe('active');
  });
});
