// src/app/community/presentation/community-social-access-error.messages.ts
// -----------------------------------------------------------------------------
// COMMUNITY SOCIAL ACCESS ERROR MESSAGES
// -----------------------------------------------------------------------------
// Mensagens seguras compartilhadas pelas superfícies de leitura de Comunidades.
// A decisão de autorização continua no backend e a superfície visual continua
// centralizada no ApplicationErrorService/ErrorNotificationService.
// -----------------------------------------------------------------------------

export type CommunitySocialAccessErrorMessageMap = Readonly<
  Record<string, string>
>;

export const COMMUNITY_SOCIAL_ACCESS_REASON_MESSAGES:
  CommunitySocialAccessErrorMessageMap = Object.freeze({
    current_terms_required:
      'Revise e aceite os Termos atuais para continuar em Comunidades.',
    age_reverification_required:
      'Conclua a reverificação de maioridade para continuar em Comunidades.',
    adult_access_required:
      'Confirme seu acesso adulto para continuar em Comunidades.',
    adult_access_denied:
      'O acesso adulto não está disponível para esta conta.',
    account_restricted:
      'Sua conta não pode acessar recursos sociais neste momento.',
  });
