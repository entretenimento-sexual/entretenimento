// src/app/core/guards/compliance/adult-content-consent.guard.ts
// -----------------------------------------------------------------------------
// AdultContentConsentGuard
// -----------------------------------------------------------------------------
// Camada de entrada adulta para rotas autenticadas sensíveis.
//
// Escopo desta etapa:
// - libera imediatamente se houver cache local versionado;
// - consulta users/{uid}.adultConsent quando não houver cache local;
// - redireciona para tela própria quando o aceite ainda não existe;
// - não substitui verificação real de idade, moderação ou KYC.
// -----------------------------------------------------------------------------

import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';

import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';
import { hasAdultContentConsent } from './adult-content-consent.storage';

export const adultContentConsentGuard: CanActivateFn = (_route, state): GuardResult | Observable<GuardResult> => {
  const router = inject(Router);
  const adultConsent = inject(AdultConsentService);

  const redirectToConsent = (): GuardResult => {
    guardLog('adult-consent', 'redirect-to-consent', { url: state.url });

    return buildRedirectTree(router, '/adulto/confirmar', state.url, {
      reason: 'adult_content_consent_required',
    });
  };

  if (hasAdultContentConsent()) {
    guardLog('adult-consent', 'accepted-local', { url: state.url });
    return true;
  }

  return adultConsent.currentConsentAccepted$.pipe(
    take(1),
    map((accepted): GuardResult => {
      if (accepted) {
        guardLog('adult-consent', 'accepted-backend', { url: state.url });
        return true;
      }

      return redirectToConsent();
    }),
    catchError(() => of(redirectToConsent()))
  );
};
