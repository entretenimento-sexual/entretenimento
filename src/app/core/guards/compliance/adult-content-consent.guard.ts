// src/app/core/guards/compliance/adult-content-consent.guard.ts
// -----------------------------------------------------------------------------
// AdultContentConsentGuard
// -----------------------------------------------------------------------------
// Camada local de entrada adulta para rotas autenticadas sensíveis.
//
// Escopo desta etapa:
// - confirma maioridade e ciência de conteúdo adulto no navegador;
// - persiste aceite versionado em localStorage;
// - não substitui verificação real de idade, moderação, KYC ou regras backend.
//
// Evolução esperada:
// - gravar aceite versionado no Firestore;
// - exigir revalidação quando o termo mudar;
// - conectar com fluxo real de verificação de idade quando definido.
// -----------------------------------------------------------------------------

import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

const ADULT_CONSENT_STORAGE_KEY = 'adult-content-consent:v1';
const ADULT_CONSENT_VALUE = 'accepted';

export const adultContentConsentGuard: CanActivateFn = (_route, state): GuardResult => {
  const router = inject(Router);
  const notify = inject(ErrorNotificationService);

  if (typeof window === 'undefined') {
    return true;
  }

  try {
    const accepted = window.localStorage.getItem(ADULT_CONSENT_STORAGE_KEY) === ADULT_CONSENT_VALUE;

    if (accepted) {
      guardLog('adult-consent', 'accepted', { url: state.url });
      return true;
    }

    const confirmed = window.confirm(
      'Esta plataforma é destinada exclusivamente a maiores de 18 anos. Ao continuar, você declara ser maior de idade e concorda em acessar conteúdo adulto de forma consciente.'
    );

    if (!confirmed) {
      notify.showWarning('Acesso permitido apenas para maiores de 18 anos.', 4200);
      return buildRedirectTree(router, '/login', state.url, { reason: 'adult_content_consent_required' });
    }

    window.localStorage.setItem(ADULT_CONSENT_STORAGE_KEY, ADULT_CONSENT_VALUE);
    guardLog('adult-consent', 'accepted-now', { url: state.url });
    return true;
  } catch (error) {
    notify.showWarning('Confirme a autorização de conteúdo adulto para continuar.', 4200);
    return buildRedirectTree(router, '/login', state.url, { reason: 'adult_content_consent_unavailable' });
  }
};
