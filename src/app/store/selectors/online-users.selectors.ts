//src\app\store\selectors\online-users.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../states/app.state';
import { IUserState } from '../states/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const selectUserState = (state: AppState): IUserState => state.user;

// Seletor para obter todos os usuários online
export const selectAllOnlineUsers = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => state.onlineUsers
);

export const selectLoadingOnlineUsers = createSelector(
  selectUserState,
  (state: IUserState) => state.loading  // Seleciona o estado de carregamento
);

export const selectOnlineUsersError = createSelector(
  selectUserState,
  (state: IUserState) => state.error  // Seleciona o erro associado a usuários online
);

// Seletor para filtrar os usuários online por região específica
export const selectOnlineUsersByRegion = (region: string) =>
  createSelector(
    selectAllOnlineUsers,
    (onlineUsers: IUserDados[]): IUserDados[] => {
      const normalizedRegion = region?.trim().toLowerCase();
      return onlineUsers.filter(user => {
        const userMunicipio = user.municipio?.trim().toLowerCase() || '';
        return userMunicipio === normalizedRegion;
      });
    }
  );
