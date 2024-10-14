// src\app\store\selectors\auth.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../states/app.state';
import { IUserState } from '../states/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const selectUserState = (state: AppState): IUserState => {
  console.log('selectUserState: ', state.user);
  return state.user;
};

// Seletor para obter o usuário autenticado
export const selectAuthenticatedUser = createSelector(
  selectUserState,
  (state: IUserState): IUserDados | null => {
    console.log('selectAuthenticatedUser (currentUser no estado): ', state.currentUser);
    return state.currentUser || null;
  }
);

// Seletor para verificar se o usuário está autenticado
export const selectIsAuthenticated = createSelector(
  selectAuthenticatedUser,
  (authenticatedUser: IUserDados | null) => {
    const isAuthenticated = !!authenticatedUser?.uid;
    console.log('selectIsAuthenticated: ', isAuthenticated);
    return isAuthenticated;
  }
);

// Seletor para verificar se o usuário tem os campos `municipio` e `gender` preenchidos
export const selectHasRequiredFields = createSelector(
  selectAuthenticatedUser,
  (authenticatedUser: IUserDados | null) => {
    const hasFields = !!authenticatedUser?.municipio && !!authenticatedUser?.gender;
    console.log('selectHasRequiredFields: ', hasFields);
    return hasFields;
  }
);
