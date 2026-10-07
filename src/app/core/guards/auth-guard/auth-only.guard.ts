// src/app/core/guards/auth-guard/auth-only.guard.ts
// Nome público preservado para as rotas de conta.
//
// Uma sessão Firebase técnica pode continuar existindo durante os cleanups do
// LogoutService. O acesso às rotas deve usar a MESMA autoridade operacional do
// authGuard, incluindo isTerminating$ e a restauração de sessão no refresh.
import { type CanActivateFn } from '@angular/router';
import { authGuard } from './auth.guard';

export const authOnlyGuard: CanActivateFn = authGuard;
