// src/app/core/guards/compliance/adult-content-consent.guard.ts
// -----------------------------------------------------------------------------
// AdultContentConsentGuard
// -----------------------------------------------------------------------------
// Camada local de entrada adulta para rotas autenticadas sensíveis.
//
// Escopo desta etapa:
// - verifica aceite local versionado;
// - redireciona para tela própria quando o aceite ainda não existe;
// - não substitui verificação real de idade, moderação, KYC ou regras backend.
// -----------------------------------------------------------------------------

import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';

import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';
import { hasAdultContentConsent } from './adult-content-consent.storage';

export const adultContentConsentGuard: CanActivateFn = (_route, state): GuardResult => {
  const router = inject(Router);

  if (hasAdultContentConsent()) {
    guardLog('adult-consent', 'accepted', { url: state.url });
    return true;
  }

  guardLog('adult-consent', 'redirect-to-consent', { url: state.url });
  return buildRedirectTree(router, '/adulto/confirmar', state.url, {
    reason: 'adult_content_consent_required',
  });
};
