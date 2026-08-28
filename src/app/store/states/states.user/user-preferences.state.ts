// src/app/store/states/states.user/user-preferences.state.ts
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';

/**
 * Projeção legada normalizada por UID.
 *
 * A fonte de persistência continua sendo UserPreferencesService/Firestore.
 * O Store mantém somente dados plain já sanitizados na borda do service.
 */
export interface UserPreferencesState {
  readonly preferences: Readonly<Record<string, IUserPreferences>>;
}

export const initialUserPreferencesState: UserPreferencesState = {
  preferences: {},
};
