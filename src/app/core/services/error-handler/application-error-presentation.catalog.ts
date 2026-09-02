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
    current_terms_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Termos atualizados',
      detail:
        'Revise e aceite a versão vigente antes de continuar usando recursos sociais da plataforma.',
      primaryAction: {
        label: 'Revisar termos',
        route: '/register/aceitar-termos',
      },
      dismissLabel: 'Agora não',
    },
    age_reverification_required: {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirmação de maioridade necessária',
      detail:
        'Conclua a reverificação de maioridade para voltar a acessar os recursos adultos e sociais.',
      primaryAction: {
        label: 'Revalidar agora',
        route: '/adulto/revalidar',
      },
      dismissLabel: 'Agora não',
    },
    adult_access_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Confirme seu acesso adulto',
      detail:
        'Esta confirmação é necessária antes de acessar recursos adultos e sociais.',
      primaryAction: {
        label: 'Confirmar acesso',
        route: '/adulto/confirmar',
      },
      dismissLabel: 'Agora não',
    },
    adult_access_denied: {
      surface: 'modal',
      severity: 'warning',
      title: 'Acesso adulto indisponível',
      detail:
        'Consulte o status da conta para verificar as opções disponíveis e eventuais ações necessárias.',
      primaryAction: {
        label: 'Ver status da conta',
        route: '/conta/status',
      },
      dismissLabel: 'Fechar',
    },
    account_restricted: {
      surface: 'modal',
      severity: 'warning',
      title: 'Acesso social temporariamente indisponível',
      detail:
        'Consulte o status da conta para entender a restrição e as opções disponíveis.',
      primaryAction: {
        label: 'Ver status da conta',
        route: '/conta/status',
      },
      dismissLabel: 'Fechar',
    },
  });

export const COMMON_APPLICATION_ERROR_RECOMMENDED_ACTION_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    accept_current_terms: {
      surface: 'modal',
      severity: 'info',
      title: 'Termos atualizados',
      detail:
        'Revise e aceite a versão vigente para continuar.',
      primaryAction: {
        label: 'Revisar termos',
        route: '/register/aceitar-termos',
      },
      dismissLabel: 'Agora não',
    },
    complete_age_reverification: {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirmação de maioridade necessária',
      detail:
        'Conclua a reverificação de maioridade para continuar.',
      primaryAction: {
        label: 'Revalidar agora',
        route: '/adulto/revalidar',
      },
      dismissLabel: 'Agora não',
    },
    confirm_adult_access: {
      surface: 'modal',
      severity: 'info',
      title: 'Confirme seu acesso adulto',
      detail:
        'Esta confirmação é necessária antes de acessar recursos adultos e sociais.',
      primaryAction: {
        label: 'Confirmar acesso',
        route: '/adulto/confirmar',
      },
      dismissLabel: 'Agora não',
    },
    review_account: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verifique o status da sua conta',
      detail:
        'Há uma condição da conta que precisa ser consultada antes de continuar.',
      primaryAction: {
        label: 'Ver status da conta',
        route: '/conta/status',
      },
      dismissLabel: 'Fechar',
    },
    complete_profile: {
      surface: 'modal',
      severity: 'info',
      title: 'Complete seu perfil',
      detail:
        'Finalize os dados obrigatórios do perfil para liberar esta experiência.',
      primaryAction: {
        label: 'Finalizar perfil',
        route: '/register/finalizar-cadastro',
      },
      dismissLabel: 'Agora não',
    },
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
