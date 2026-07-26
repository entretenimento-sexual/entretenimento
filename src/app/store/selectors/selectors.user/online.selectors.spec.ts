// src/app/store/selectors/selectors.user/online.selectors.spec.ts
import { describe, expect, it } from 'vitest';

import type { IUserDados } from '../../../core/interfaces/iuser-dados';
import {
  selectGlobalOnlineUsers,
  selectGlobalOnlineUsersDebug,
} from './online.selectors';

describe('online selectors with discovery preferences', () => {
  it('mantém somente os tipos de perfil escolhidos pelo usuário', () => {
    const viewer = user('viewer', {
      discoveryPreferences: {
        genderInterests: ['women'],
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: null,
        updatedAt: 1,
      },
      interestedInGenders: ['woman'],
    });

    const online = [
      user('man', {
        nickname: 'Homem',
        gender: 'homem',
        isOnline: true,
      }),
      user('woman', {
        nickname: 'Mulher',
        gender: 'mulher',
        isOnline: true,
      }),
    ];

    const result = selectGlobalOnlineUsers.projector(
      online,
      {},
      viewer.uid,
      viewer
    );

    expect(result.map((candidate) => candidate.uid)).toEqual(['woman']);
  });

  it('expõe no debug o motivo de rejeição por tipo não selecionado', () => {
    const viewer = user('viewer', {
      discoveryPreferences: {
        genderInterests: ['couple_mf'],
        acceptsCouples: true,
        acceptsSingles: false,
        acceptsTransProfiles: null,
        updatedAt: 1,
      },
      interestedInGenders: ['couple'],
    });

    const single = user('single', {
      nickname: 'Pessoa',
      gender: 'mulher',
      isOnline: true,
    });

    const debug = selectGlobalOnlineUsersDebug.projector(
      [single],
      {},
      viewer.uid,
      viewer
    );

    expect(debug).toEqual([
      expect.objectContaining({
        uid: 'single',
        rejectionReason: 'singles_disabled',
      }),
    ]);
  });
});

function user(uid: string, patch: Partial<IUserDados> = {}): IUserDados {
  return {
    uid,
    email: null,
    photoURL: null,
    role: 'free',
    lastLogin: 0,
    descricao: '',
    isSubscriber: false,
    ...patch,
  };
}
