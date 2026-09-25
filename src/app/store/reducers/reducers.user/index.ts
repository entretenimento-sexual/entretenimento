// src/app/store/reducers/reducers.user/index.ts
// Não esqueça os comentários
import { authReducer } from './auth.reducer';
import { userReducer } from './user.reducer';
import { fileReducer } from './file.reducer';
import { userPreferencesReducer } from './user-preferences.reducer';

export const userReducers = {
  auth: authReducer,
  user: userReducer,
  file: fileReducer,
  userPreferences: userPreferencesReducer,
};
