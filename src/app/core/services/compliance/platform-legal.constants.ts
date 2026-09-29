export const TERMS_ACCEPTANCE_VERSION = 'v3';
export const TERMS_DOCUMENT_VERSION = '2026-09-29.1';
export const PRIVACY_NOTICE_VERSION = '2026-09-29.1';
export const COOKIE_NOTICE_VERSION = '2026-09-29.1';
export const COOKIE_NOTICE_EFFECTIVE_DATE_ISO = '2026-09-29';
export const COOKIE_NOTICE_EFFECTIVE_DATE_LABEL = '29 de setembro de 2026';
export const PLATFORM_LEGAL_EFFECTIVE_DATE_ISO = '2026-09-29';
export const PLATFORM_LEGAL_EFFECTIVE_DATE_LABEL = '29 de setembro de 2026';
export const PLATFORM_LEGAL_REACCEPT_REQUIRED = true;

export const PLATFORM_LEGAL_CHANGE_SUMMARY = Object.freeze([
  'proteção etária e verificação de maioridade para acesso a conteúdo adulto',
  'separação entre suspeita, apuração e infração confirmada',
  'notificação, manifestação do usuário e revisão de medidas de moderação',
  'regras sobre conteúdo consentido, segurança, assinaturas, pagamentos e prevenção a fraudes',
  'transparência sobre privacidade, bases legais e direitos dos titulares',
] as const);

export const PLATFORM_LEGAL_MANIFEST = Object.freeze({
  termsAcceptanceVersion: TERMS_ACCEPTANCE_VERSION,
  termsDocumentVersion: TERMS_DOCUMENT_VERSION,
  privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  cookieNoticeVersion: COOKIE_NOTICE_VERSION,
  cookieNoticeEffectiveDateIso: COOKIE_NOTICE_EFFECTIVE_DATE_ISO,
  cookieNoticeEffectiveDateLabel: COOKIE_NOTICE_EFFECTIVE_DATE_LABEL,
  effectiveDateIso: PLATFORM_LEGAL_EFFECTIVE_DATE_ISO,
  effectiveDateLabel: PLATFORM_LEGAL_EFFECTIVE_DATE_LABEL,
  reacceptRequired: PLATFORM_LEGAL_REACCEPT_REQUIRED,
  changeSummary: PLATFORM_LEGAL_CHANGE_SUMMARY,
});
