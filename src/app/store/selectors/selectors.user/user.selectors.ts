//src\app\store\selectors\selectors.user\user.selectors.ts
import { createSelector, MemoizedSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Seleciona o estado de usuário do estado global da aplicação.
export const selectUserState = (state: AppState): IUserState => state.user;

// Seleciona o usuário atual no estado.
export const selectCurrentUser: MemoizedSelector<AppState, IUserDados | null> = createSelector(
  selectUserState,
  (state: IUserState): IUserDados | null => {
    console.log('Selecionando o usuário atual:', state.currentUser);
    return state.currentUser ? state.currentUser : null;
  }
);

/** ✅ Novo: emite apenas uid (string | undefined) */
export const selectCurrentUserUid = createSelector(
  selectCurrentUser,
  (u) => u?.uid
);

// Seleciona todos os usuários armazenados no estado.
export const selectAllUsers = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => {
    const usersArray = Object.values(state.users);
    console.log('Selecionando todos os usuários armazenados no estado:', usersArray.length);
    return usersArray;
  }
);

/**
 * Seleciona um usuário específico pelo UID.
 * @param uid - Identificador único do usuário.
 */
export const selectUserById = (uid: string) =>
  createSelector(
    selectUserState,
    (state: IUserState) => {
      const foundUser = state.users[uid] || {} as IUserDados; // ✅ Retorna objeto vazio
      console.log(`Selecionando usuário pelo UID (${uid}):`, foundUser);
      return foundUser;
    }
  );

// Seleciona todos os usuários online.
export const selectAllOnlineUsers = createSelector(
  selectAllUsers,
  (users: IUserDados[]): IUserDados[] => {
    const onlineUsers = users.filter((user) => user.isOnline);
    console.log('Selecionando todos os usuários online:', onlineUsers.length);
    return onlineUsers;
  }
);

/**
 * Seleciona os usuários online em uma região específica.
 * @param region - Nome da região ou município.
 */
export const selectOnlineUsersByRegion = (region: string) =>
  createSelector(
    selectAllOnlineUsers,
    (onlineUsers: IUserDados[]): IUserDados[] => {
      const normalizedRegion = region.trim().toLowerCase();
      const filteredUsers = onlineUsers.filter((user) => {
        const userMunicipio = user.municipio?.trim().toLowerCase() || '';
        return userMunicipio === normalizedRegion;
      });
      console.log(`Usuários online filtrados pela região (${region}):`, filteredUsers.length);
      return filteredUsers;
    }
  );

// Seleciona o estado de carregamento (loading) do estado de usuários.
export const selectUserLoading = createSelector(
  selectUserState,
  (state: IUserState) => {
    console.log('Estado de carregamento do usuário:', state.loading);
    return state.loading;
  }
);

// Seleciona os erros relacionados ao estado de usuários.
export const selectUserError = createSelector(
  selectUserState,
  (state: IUserState) => {
    console.log('Erro relacionado ao estado do usuário:', state.error);
    return state.error;
  }
);

export const selectHasRequiredFields = createSelector(
  selectCurrentUser,
  (user: IUserDados | null) => !!user?.municipio && !!user?.gender
);
