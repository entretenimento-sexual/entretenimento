// src/app/store/selectors/user.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../states/app.state';
import { UserState } from '../states/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Seletor para obter o estado do usuário
export const selectUserState = (state: AppState): UserState => {
  return state.user || { users: [], filteredUsers: [], loading: false, error: null };
};

// Seletor para obter todos os usuários
export const selectAllUsers = createSelector(
  selectUserState,
  (state: UserState): IUserDados[] => state?.users || []
);

export const selectAllOnlineUsers = createSelector(
  selectAllUsers,
  (users: IUserDados[]): IUserDados[] => {
    // Filtra usuários que têm o campo 'isOnline' como true
    return users.filter(user => user.isOnline);
  }
);


// Seletor para filtrar os usuários online por região específica
export const selectOnlineUsersByRegion = (region: string) => createSelector(
  selectAllOnlineUsers,  // Usa o seletor de todos os usuários online
  (onlineUsers: IUserDados[]): IUserDados[] => {
    const normalizedRegion = region.trim().toLowerCase();
    return onlineUsers.filter(user => {
      const userMunicipio = user.municipio?.trim().toLowerCase() || '';
      return userMunicipio === normalizedRegion;
    });
  }
);
