// src/app/store/selectors/user.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Seletor para obter o estado do usuário
export const selectUserState = (state: AppState): IUserState => state.user;

// Seletor para obter todos os usuários
export const selectAllUsers = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => state?.users || []
);

// Seletor memoizado para obter um usuário específico pelo UID
export const selectUserById = (uid: string) =>
  createSelector(
    selectAllUsers,
    (users: IUserDados[]) => {
      const foundUser = users.find(user => user.uid === uid) || null;
      console.log(`Selecionando usuário pelo UID ${uid}:`, foundUser); // Log para verificar a busca
      return foundUser;
    }
  );

// Seletor para obter todos os usuários online
export const selectAllOnlineUsers = createSelector(
  selectAllUsers,
  (users: IUserDados[]): IUserDados[] => users.filter(user => user.isOnline)
);

// Seletor para filtrar os usuários online por região específica
export const selectOnlineUsersByRegion = (region: string) =>
  createSelector(
    selectAllOnlineUsers,
    (onlineUsers: IUserDados[]): IUserDados[] => {
      const normalizedRegion = region.trim().toLowerCase();
      return onlineUsers.filter(user => {
        const userMunicipio = user.municipio?.trim().toLowerCase() || '';
        return userMunicipio === normalizedRegion;
      });
    }
  );

// Seletor para obter o estado de carregamento (loading)
export const selectUserLoading = createSelector(
  selectUserState,
  (state: IUserState) => state.loading
);

// Seletor para obter erros relacionados ao estado do usuário
export const selectUserError = createSelector(
  selectUserState,
  (state: IUserState) => state.error
);
