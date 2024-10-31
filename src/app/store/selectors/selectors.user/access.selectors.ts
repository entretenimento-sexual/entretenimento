// src/app/store/selectors/access.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';

// Seletor para obter o estado do usuário
export const selectUserState = (state: AppState): IUserState => state.user;

// Seletor para verificar se o usuário tem acesso básico (basico, premium, vip)
export const selectHasBasicAccess = createSelector(
  selectUserState,
  (state: IUserState): boolean =>
    state.users.some(user => ['basico', 'premium', 'vip'].includes(user.role))
);

// Seletor para verificar se o usuário tem acesso premium (premium, vip)
export const selectHasPremiumAccess = createSelector(
  selectUserState,
  (state: IUserState): boolean =>
    state.users.some(user => ['premium', 'vip'].includes(user.role))
);

// Seletor para verificar se o usuário tem acesso VIP
export const selectHasVipAccess = createSelector(
  selectUserState,
  (state: IUserState): boolean =>
    state.users.some(user => user.role === 'vip')
);
