import { describe, expect, it } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { normalizeCurrentUserRuntimeVisibility } from './current-user-store.service';

describe('normalizeCurrentUserRuntimeVisibility', () => {
  function user(overrides: Partial<IUserDados> = {}): IUserDados {
    return {
      uid: 'user-1',
      email: 'user@example.com',
      nickname: 'user',
      role: 'free',
      profileCompleted: true,
      isSubscriber: false,
      accountStatus: 'active',
      publicVisibility: 'visible',
      interactionBlocked: false,
      ...overrides,
    } as IUserDados;
  }

  it('mantém conta ativa e completa conforme o backend entregou', () => {
    const current = user();

    expect(normalizeCurrentUserRuntimeVisibility(current)).toBe(current);
  });

  it('oculta e bloqueia perfil incompleto vindo do login social', () => {
    expect(
      normalizeCurrentUserRuntimeVisibility(
        user({
          profileCompleted: false,
          publicVisibility: 'visible',
          interactionBlocked: false,
        })
      )
    ).toEqual(
      expect.objectContaining({
        profileCompleted: false,
        publicVisibility: 'hidden',
        interactionBlocked: true,
      })
    );
  });

  it('trata profileCompleted ausente como estado incompleto', () => {
    expect(
      normalizeCurrentUserRuntimeVisibility(
        user({
          profileCompleted: undefined,
          publicVisibility: 'visible',
          interactionBlocked: false,
        })
      )
    ).toEqual(
      expect.objectContaining({
        publicVisibility: 'hidden',
        interactionBlocked: true,
      })
    );
  });

  it('mantém conta suspensa invisível mesmo com projeção temporária incorreta', () => {
    expect(
      normalizeCurrentUserRuntimeVisibility(
        user({
          accountStatus: 'moderation_suspended',
          publicVisibility: 'visible',
          interactionBlocked: false,
        })
      )
    ).toEqual(
      expect.objectContaining({
        publicVisibility: 'hidden',
        interactionBlocked: true,
      })
    );
  });

  it('não cria novo objeto quando o estado já está protegido', () => {
    const current = user({
      profileCompleted: false,
      publicVisibility: 'hidden',
      interactionBlocked: true,
    });

    expect(normalizeCurrentUserRuntimeVisibility(current)).toBe(current);
  });
});
