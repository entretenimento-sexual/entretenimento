// src/app/store/actions/actions.user/user-preferences.actions.ts
import { createAction, props } from '@ngrx/store';

import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';

/**
 * Projeções serializáveis do fluxo legado de preferências.
 *
 * O owner de leitura, cache SWR e persistência continua sendo
 * UserPreferencesService. Estas actions só atualizam o Store depois que uma
 * leitura foi resolvida ou depois que o writeBatch foi confirmado.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - loadUserPreferences e loadUserPreferencesFailure foram removidas porque não
 *   existia consumidor que despachasse o comando;
 * - UserPreferencesEffects duplicava a leitura já executada pelo service.
 */
export const loadUserPreferencesSuccess = createAction(
  '[User Preferences] Load Preferences Success',
  props<{ uid: string; preferences: IUserPreferences }>()
);

/**
 * Nome preservado por compatibilidade.
 *
 * Esta action representa a aplicação de um patch já persistido pelo service;
 * não é uma atualização otimista nem um comando direto para o Firestore.
 */
export const updateUserPreferences = createAction(
  '[User Preferences] Update Preferences',
  props<{ uid: string; preferences: Partial<IUserPreferences> }>()
);
