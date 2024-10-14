//src\app\store\selectors\access.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../states/app.state';
import { IUserState } from '../states/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const selectUserState = (state: AppState): IUserState => state.user;

// Seletor para verificar se o usuário tem acesso básico
export const selectHasBasicAccess = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => state.users.filter(user => ['basico', 'premium', 'vip'].includes(user.role))
);

// Seletor para verificar se o usuário tem acesso premium
export const selectHasPremiumAccess = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => state.users.filter(user => ['premium', 'vip'].includes(user.role))
);

// Seletor para verificar se o usuário tem acesso VIP
export const selectHasVipAccess = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => state.users.filter(user => user.role === 'vip')
);
