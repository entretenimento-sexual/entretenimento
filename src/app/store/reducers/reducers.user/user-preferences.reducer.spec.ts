// src/app/store/reducers/reducers.user/user-preferences.reducer.spec.ts
import { describe, expect, it } from 'vitest';

import {
  loadUserPreferencesSuccess,
  updateUserPreferences,
} from '../../actions/actions.user/user-preferences.actions';
import { initialUserPreferencesState } from '../../states/states.user/user-preferences.state';
import { userPreferencesReducer } from './user-preferences.reducer';

describe('userPreferencesReducer', () => {
  it('usa a definição canônica de estado e projeta uma leitura resolvida por UID', () => {
    const next = userPreferencesReducer(
      initialUserPreferencesState,
      loadUserPreferencesSuccess({
        uid: ' user-1 ',
        preferences: {
          genero: ['mulher'],
          relacionamento: ['amizade'],
        },
      })
    );

    expect(next.preferences['user-1']).toEqual({
      genero: ['mulher'],
      relacionamento: ['amizade'],
    });
    expect(next.preferences[' user-1 ']).toBeUndefined();
  });

  it('mescla somente o patch já persistido sem apagar outras categorias', () => {
    const state = {
      ...initialUserPreferencesState,
      preferences: {
        'user-1': {
          genero: ['mulher'],
          praticaSexual: ['beijo'],
          relacionamento: ['amizade'],
        },
      },
    };

    const next = userPreferencesReducer(
      state,
      updateUserPreferences({
        uid: 'user-1',
        preferences: {
          relacionamento: ['namoro'],
        },
      })
    );

    expect(next.preferences['user-1']).toEqual({
      genero: ['mulher'],
      praticaSexual: ['beijo'],
      relacionamento: ['namoro'],
    });
    expect(state.preferences['user-1'].relacionamento).toEqual(['amizade']);
  });

  it('ignora UID vazio sem criar chave inválida', () => {
    const next = userPreferencesReducer(
      initialUserPreferencesState,
      updateUserPreferences({
        uid: '   ',
        preferences: { genero: ['homem'] },
      })
    );

    expect(next).toBe(initialUserPreferencesState);
    expect(Object.keys(next.preferences)).toEqual([]);
  });
});
