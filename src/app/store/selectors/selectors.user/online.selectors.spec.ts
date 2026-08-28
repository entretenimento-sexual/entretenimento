// src/app/store/selectors/selectors.user/online.selectors.spec.ts
import { describe, expect, it } from 'vitest';

import type { IUserDados } from '../../../core/interfaces/iuser-dados';
import {
  selectGlobalOnlineUsers,
  selectGlobalOnlineUsersDebug,
} from './online.selectors';

describe('online selectors', () => {
  it('materializa perfis públicos online sem aplicar preferências do viewer', () => {
    const online = [
      user('man', { nickname: 'Homem', gender: 'homem', isOnline: true }),
      user('woman', {
        nickname: 'Mulher',
        gender: 'mulher',
        age: 31,
        publicRelationshipIntents: ['dating'],
        publicBodyTraits: ['tattoos'],
        isOnline: true,
      }),
    ];

    const result = selectGlobalOnlineUsers.projector(online, {}, 'viewer');

    expect(result.map((candidate) => candidate.uid)).toEqual(['man', 'woman']);
    expect(result[1]).toEqual(expect.objectContaining({
      age: 31,
      publicRelationshipIntents: ['dating'],
      publicBodyTraits: ['tattoos'],
    }));
  });

  it('expõe somente motivos de presença no debug', () => {
    const offline = user('offline', {
      nickname: 'Pessoa',
      gender: 'mulher',
      isOnline: false,
    });

    const debug = selectGlobalOnlineUsersDebug.projector([offline], {}, 'viewer');

    expect(debug).toEqual([
      expect.objectContaining({ uid: 'offline', rejectionReason: 'not_online' }),
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
