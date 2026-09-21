// src/app/community/presentation/community-error.presentations.ts
// -----------------------------------------------------------------------------
// COMMUNITY ERROR PRESENTATIONS
// -----------------------------------------------------------------------------
// Catálogo de superfície visual para razões estruturadas do domínio Comunidades.
// Mensagens permanecem em `community-error.messages.ts`; regras continuam nas
// Functions. Este arquivo decide apenas como um erro já normalizado deve aparecer.
// -----------------------------------------------------------------------------

import type {
  ApplicationErrorPresentationMap,
} from 'src/app/core/services/error-handler/application-error-presentation.model';
export const COMMUNITY_CREATE_REASON_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    community_creation_subscription_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Crie sua própria Comunidade',
      detail:
        'Participar continua gratuito. Uma assinatura compatível libera a criação e a administração de Comunidades.',
      primaryAction: {
        label: 'Ver planos',
        route: '/subscription-plan',
      },
      dismissLabel: 'Agora não',
    },
    community_creation_limit_reached: {
      surface: 'modal',
      severity: 'info',
      title: 'Limite de Comunidades atingido',
      detail:
        'Suas Comunidades atuais continuam funcionando. Gerencie uma delas antes de criar outra.',
      primaryAction: {
        label: 'Gerenciar Comunidades',
        route: '/dashboard/comunidades/minhas',
      },
      dismissLabel: 'Continuar aqui',
    },
    community_capacity_upgrade_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Essa capacidade exige outro plano',
      detail:
        'Escolha uma capacidade compatível com sua conta ou compare os planos disponíveis.',
      primaryAction: {
        label: 'Ver planos',
        route: '/subscription-plan',
      },
      dismissLabel: 'Revisar capacidade',
    },
    account_restricted: {
      surface: 'modal',
      severity: 'warning',
      title: 'Criação temporariamente indisponível',
      detail:
        'Revise o estado da sua conta antes de tentar criar outra Comunidade.',
    },
  });

export const COMMUNITY_SETTINGS_REASON_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    'recent-authentication-required': {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirme sua identidade novamente',
      detail:
        'Alterações sensíveis de capacidade exigem uma autenticação recente.',
    },
    community_capacity_upgrade_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Essa capacidade não está no seu plano',
      detail:
        'A capacidade atual permanece inalterada. Compare os planos antes de tentar novamente.',
      primaryAction: {
        label: 'Ver planos',
        route: '/subscription-plan',
      },
      dismissLabel: 'Manter capacidade atual',
    },
    official_capacity_entitlement_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Capacidade oficial não liberada',
      detail:
        'A capacidade atual permanece inalterada até existir um entitlement Business/Official válido.',
    },
    official_capacity_entitlement_inactive: {
      surface: 'modal',
      severity: 'warning',
      title: 'Capacidade oficial inativa',
      detail:
        'A capacidade atual permanece inalterada até a renovação do entitlement Business/Official.',
    },
    official_capacity_entitlement_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Entitlement oficial inconsistente',
      detail:
        'A capacidade não pode ser alterada até a fonte Business/Official ser reconciliada.',
    },
    official_capacity_entitlement_exceeded: {
      surface: 'modal',
      severity: 'info',
      title: 'Capacidade acima do entitlement',
      detail:
        'Escolha uma capacidade dentro do limite concedido para este espaço oficial.',
    },
    account_restricted: {
      surface: 'modal',
      severity: 'warning',
      title: 'Configuração temporariamente indisponível',
      detail:
        'O estado atual da conta não permite alterar estas configurações.',
    },
  });

export const COMMUNITY_MEMBERSHIP_ACTION_REASON_PRESENTATIONS:
  ApplicationErrorPresentationMap = Object.freeze({
    owner_transfer_required: {
      surface: 'modal',
      severity: 'warning',
      title: 'Transfira a propriedade antes de sair',
      detail:
        'A Comunidade precisa manter um proprietário ativo antes que seu vínculo possa ser encerrado.',
    },
    account_restricted: {
      surface: 'modal',
      severity: 'warning',
      title: 'Participação temporariamente indisponível',
    },
  });
