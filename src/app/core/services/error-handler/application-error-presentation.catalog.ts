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

export const COMMON_APPLICATION_ERROR_REASON_MESSAGES:
  Readonly<Record<string, string>> = Object.freeze({
    official_claim_verification_required:
      'Conclua a verificação necessária para este vínculo antes de solicitar a Comunidade Oficial.',
    official_claim_verification_inactive:
      'A verificação usada para comprovar este vínculo está inativa ou vencida.',
    official_claim_target_inactive:
      'O Local ou a Organização selecionada não está ativo para receber um vínculo oficial.',
    official_claim_target_authority_mismatch:
      'Sua autoridade sobre o Local ou a Organização selecionada não pôde ser confirmada.',
    official_claim_unsupported_target:
      'Este tipo de vínculo oficial ainda não está disponível.',
    official_claim_evidence_authority_reference_mismatch:
      'A referência de autoridade do vínculo não corresponde mais ao registro canônico.',
    official_claim_evidence_authority_grant_invalid:
      'A verificação comercial necessária para este vínculo não pôde ser confirmada.',
    official_claim_evidence_authority_grant_inactive:
      'A verificação comercial necessária para este vínculo está inativa ou vencida.',
    official_claim_evidence_sponsor_organization_mismatch:
      'A organização vinculada à verificação não corresponde ao vínculo solicitado.',
    official_claim_evidence_venue_not_active:
      'O Local não está ativo para receber ou manter a verificação oficial.',
    official_claim_evidence_venue_authority_mismatch:
      'A autoridade sobre o Local não pôde ser revalidada.',
    official_claim_evidence_organization_kyb_invalid:
      'O KYB da Organização não pôde ser confirmado para esta verificação.',
    official_claim_evidence_organization_kyb_inactive:
      'O KYB da Organização está inativo, vencido ou precisa de revalidação.',
    official_claim_evidence_organization_not_active:
      'A Organização não está ativa para receber ou manter a verificação oficial.',
    official_claim_evidence_organization_authority_mismatch:
      'A representação autorizada da Organização não pôde ser revalidada.',
    official_claim_evidence_unsupported_source:
      'A fonte de verificação deste tipo de vínculo oficial ainda não está disponível.',
  });

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
    official_claim_verification_required: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação necessária',
      detail:
        'Locais exigem verificação comercial ativa. Organizações exigem KYB válido e representação autorizada ativa.',
      dismissLabel: 'Entendi',
    },
    official_claim_verification_inactive: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação inativa',
      detail:
        'Regularize a verificação do vínculo antes de reenviar a solicitação.',
      dismissLabel: 'Entendi',
    },
    official_claim_target_inactive: {
      surface: 'modal',
      severity: 'warning',
      title: 'Vínculo indisponível',
      detail:
        'Ative ou regularize o Local ou a Organização antes de solicitar a Comunidade Oficial.',
      dismissLabel: 'Entendi',
    },
    official_claim_target_authority_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Autoridade não confirmada',
      detail:
        'O servidor não encontrou uma autoridade canônica ativa que permita representar este vínculo.',
      dismissLabel: 'Entendi',
    },
    official_claim_unsupported_target: {
      surface: 'snackbar',
      severity: 'info',
    },
    official_claim_evidence_authority_reference_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Autoridade precisa ser revalidada',
      detail:
        'O registro canônico de autoridade mudou desde o envio da solicitação.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_authority_grant_invalid: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação comercial não confirmada',
      detail:
        'A aprovação foi bloqueada porque a fonte canônica de verificação não é válida.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_authority_grant_inactive: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação comercial inativa',
      detail:
        'A aprovação foi bloqueada porque a verificação comercial expirou ou foi desativada.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_sponsor_organization_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Organização divergente',
      detail:
        'A organização registrada na fonte canônica não corresponde à solicitação.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_venue_not_active: {
      surface: 'modal',
      severity: 'warning',
      title: 'Local inativo',
      detail:
        'O Local precisa estar ativo no registro canônico para que a aprovação prossiga.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_venue_authority_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Autoridade do Local divergente',
      detail:
        'O vínculo atual de proprietário ou gestor não confirma mais a autoridade declarada.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_organization_kyb_invalid: {
      surface: 'modal',
      severity: 'warning',
      title: 'KYB não confirmado',
      detail:
        'A aprovação foi bloqueada porque o KYB canônico da Organização não é válido.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_organization_kyb_inactive: {
      surface: 'modal',
      severity: 'warning',
      title: 'KYB inativo',
      detail:
        'A aprovação foi bloqueada porque o KYB venceu, foi revogado ou precisa de revalidação.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_organization_not_active: {
      surface: 'modal',
      severity: 'warning',
      title: 'Organização inativa',
      detail:
        'A Organização precisa estar ativa no registro canônico para que a aprovação prossiga.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_organization_authority_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Representação não confirmada',
      detail:
        'A representação autorizada mudou, expirou ou não possui mais o escopo necessário.',
      dismissLabel: 'Fechar',
    },
    official_claim_evidence_unsupported_source: {
      surface: 'modal',
      severity: 'info',
      title: 'Fonte de verificação indisponível',
      detail:
        'Este tipo de vínculo permanece bloqueado até existir uma fonte canônica suportada.',
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
