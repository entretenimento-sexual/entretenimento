// src/app/core/services/error-handler/application-error-presentation.catalog.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR PRESENTATION CATALOG
// -----------------------------------------------------------------------------
// Catálogo global canônico para situações transversais da plataforma.
// Domínios específicos podem sobrescrever estas apresentações por contexto.
// -----------------------------------------------------------------------------

import type {
  ApplicationErrorPresentationMap,
} from './application-error-presentation.model';

export const COMMON_APPLICATION_ERROR_REASON_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    'recent-authentication-required': {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirme sua identidade novamente',
      detail:
        'Esta alteração é sensível e exige uma autenticação recente antes de continuar.',
    },
  });

export const COMMON_APPLICATION_ERROR_RECOMMENDED_ACTION_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    upgrade_subscription: {
      surface: 'modal',
      severity: 'info',
      title: 'Seu plano atual precisa ser atualizado',
      detail:
        'A configuração atual permanece preservada. Compare os planos disponíveis para liberar esta opção.',
      primaryAction: {
        label: 'Ver planos',
        route: '/subscription-plan',
      },
      dismissLabel: 'Agora não',
    },
  });

export const COMMON_APPLICATION_ERROR_CODE_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    'auth/requires-recent-login': {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirme sua identidade novamente',
      detail:
        'Esta alteração é sensível e exige uma autenticação recente antes de continuar.',
    },
  });
