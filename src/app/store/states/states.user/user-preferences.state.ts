// src\app\store\states\states.user\user-preferences.state.ts
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';

export interface UserPreferencesState {
  preferences: { [uid: string]: IUserPreferences };
}

export const initialUserPreferencesState: UserPreferencesState = {
  preferences: {}
};
