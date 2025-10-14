// src/app/store/selectors/selectors.user/access.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// Base: pega o slice "user"
export const selectUserState = (state: AppState): IUserState => state.user;

// Normaliza o "users" para sempre ser um array de IUserDados
export const selectUsersArray = createSelector(
  selectUserState,
  (state: IUserState): IUserDados[] => {
    const src = (state as any)?.users;
    if (Array.isArray(src)) return src as IUserDados[];
    if (src && typeof src === 'object') return Object.values(src as Record<string, IUserDados>);
    return [];
  }
);

// helper para ler a role com segurança
function getRole(u: IUserDados): string {
  // ajuste aqui se sua role vier de outro lugar (ex: u.access.role)
  return (u as any)?.role ?? '';
}

// Básico (básico, premium, vip)
export const selectHasBasicAccess = createSelector(
  selectUsersArray,
  (users: IUserDados[]): boolean =>
    users.some((user: IUserDados) => ['basico', 'premium', 'vip'].includes(getRole(user)))
);

// Premium (premium, vip)
export const selectHasPremiumAccess = createSelector(
  selectUsersArray,
  (users: IUserDados[]): boolean =>
    users.some((user: IUserDados) => ['premium', 'vip'].includes(getRole(user)))
);

// VIP
export const selectHasVipAccess = createSelector(
  selectUsersArray,
  (users: IUserDados[]): boolean =>
    users.some((user: IUserDados) => getRole(user) === 'vip')
);
