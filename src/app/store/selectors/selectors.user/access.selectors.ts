// src/app/store/selectors/selectors.user/access.selectors.ts
import { createSelector } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectCurrentUser } from './user.selectors';

/**
 * Ajuste arquitetural importante:
 * - acesso NÃO deve ser calculado a partir de "qualquer usuário do mapa"
 * - acesso deve refletir apenas o usuário autenticado atual
 */

function getRole(u: IUserDados | null): string {
  return (u as any)?.role ?? '';
}

export const selectCurrentUserRole = createSelector(
  selectCurrentUser,
  (user) => getRole(user)
);

// Básico (basic, premium, vip)
export const selectHasBasicAccess = createSelector(
  selectCurrentUserRole,
  (role: string): boolean =>
    ['basic', 'premium', 'vip'].includes(role)
);

// Premium (premium, vip)
export const selectHasPremiumAccess = createSelector(
  selectCurrentUserRole,
  (role: string): boolean =>
    ['premium', 'vip'].includes(role)
);

// VIP
export const selectHasVipAccess = createSelector(
  selectCurrentUserRole,
  (role: string): boolean =>
    role === 'vip'
);
