export const TERMS_ACCEPTANCE_VERSION = 'v3';
export const ADULT_CONSENT_VERSION = 'v1';
export const TERMS_DOCUMENT_VERSION = '2026-09-29.1';
export const PRIVACY_NOTICE_VERSION = '2026-09-29.1';
export const PLATFORM_LEGAL_EFFECTIVE_DATE_ISO = '2026-09-29';
export const PLATFORM_LEGAL_REACCEPT_REQUIRED = true;

export function matchesCurrentLegalVersions(record: Record<string, unknown>): boolean {
  return record.version === TERMS_ACCEPTANCE_VERSION &&
    record.termsDocumentVersion === TERMS_DOCUMENT_VERSION &&
    record.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;
}

export function hasAcceptedCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.accepted === true &&
    record.acknowledgedPrivacyNotice === true &&
    matchesCurrentLegalVersions(record);
}

export const PLATFORM_LEGAL_CHANGE_SUMMARY = [
  'proteção etária e verificação de maioridade para acesso a conteúdo adulto',
  'separação entre suspeita, apuração e infração confirmada',
  'notificação, manifestação do usuário e revisão de medidas de moderação',
  'regras sobre conteúdo consentido, segurança, assinaturas, pagamentos e prevenção a fraudes',
  'transparência sobre privacidade, bases legais e direitos dos titulares',
] as const;

export const ADULT_SELF_DECLARATION_VERSION = 'v1';
export const ADULT_SELF_DECLARATION_TEXT_PT_BR =
  'Declaro voluntariamente que tenho 18 anos ou mais.';
