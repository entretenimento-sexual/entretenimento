// src/app/store/selectors/user/user-profile.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Seleciona o estado do usuário
export const selectUserState = (state: AppState): IUserState => state.user;

// Seleciona os dados principais do perfil do usuário autenticado
export const selectUserProfileData = createSelector(
  selectUserState,
  (state: IUserState): Partial<IUserDados> | null => {
    const { currentUser } = state;
    if (currentUser) {
      return {
        uid: currentUser.uid,
        emailVerified: currentUser.emailVerified,
        latitude: currentUser.latitude,
        firstLogin: currentUser.firstLogin,
        createdAt: currentUser.createdAt || currentUser.firstLogin,
        // Adicione outros campos essenciais conforme necessário
      };
    }
    return null;
  }
);

// Seleciona o UID do usuário autenticado
export const selectUserUID = createSelector(
  selectUserProfileData,
  (profile) => profile?.uid || null
);

// Seleciona se o e-mail do usuário está verificado
export const selectUserEmailVerified = createSelector(
  selectUserProfileData,
  (profile) => profile?.emailVerified || false
);
