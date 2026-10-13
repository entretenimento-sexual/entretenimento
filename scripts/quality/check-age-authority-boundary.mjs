// scripts/quality/check-age-authority-boundary.mjs
// -----------------------------------------------------------------------------
// ACCOUNT AGE AUTHORITY BOUNDARY
// -----------------------------------------------------------------------------
// Contrato:
// - admissão 18+ exige autodeclaração canônica ou prova forte;
// - age_eligibility_records/{uid} permanece backend-only;
// - uma conta já admitida/ativa usa lifecycle + legal/consent no produto;
// - Media/Discovery/Chat não reinterpretam assurance etário;
// - fato novo de segurança/reverificação repercute pelo lifecycle da conta;
// - expiração técnica de assurance, sozinha, não bloqueia produto.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const violations = [];

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length));
}

function read(relativePath) {
  const file = absolute(relativePath);
  if (!fs.existsSync(file)) {
    violations.push(`${relativePath} (arquivo obrigatório ausente)`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function requireAll(relativePath, required, reason) {
  const source = read(relativePath);
  for (const token of required) {
    if (!source.includes(token)) {
      violations.push(`${relativePath} (${reason}: ${token})`);
    }
  }
}

function forbidAll(relativePath, forbidden, reason) {
  const source = codeOnly(read(relativePath));
  for (const token of forbidden) {
    if (source.includes(token)) {
      violations.push(`${relativePath} (${reason}: ${token})`);
    }
  }
}

function walk(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...walk(file, extensions));
      continue;
    }

    if (
      entry.isFile() &&
      extensions.some((extension) => entry.name.endsWith(extension)) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      found.push(file);
    }
  }

  return found;
}

// -----------------------------------------------------------------------------
// Fonte canônica e admissão
// -----------------------------------------------------------------------------

requireAll(
  'functions/src/compliance/age-eligibility.policy.ts',
  [
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
    'DENIED_UNDERAGE',
    'isTrustedAdultAgeDecision',
    'isAdultAccountAdmissionDecision',
    'EXTERNAL_PROVIDER',
    'MANUAL_REVIEW',
  ],
  'policy etária canônica incompleta'
);

requireAll(
  'functions/src/compliance/age-eligibility.service.ts',
  [
    'age_eligibility_records',
    'isTrustedAdultAgeDecision',
    'assertTrustedAdultAgeEligibility',
  ],
  'serviço etário deve preservar verificação confiável'
);

const ageRules = read('firestore-rules/age_eligibility_records.rules');
if (
  ageRules &&
  !/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(ageRules)
) {
  violations.push(
    'firestore-rules/age_eligibility_records.rules (autoridade deve permanecer backend-only)'
  );
}

requireAll(
  'firestore-rules/_helpers.rules',
  [
    'canonicalAgeEligibilityAllowsTrustedAdultAccess',
    'canonicalAgeEligibilityAllowsRegistration',
    '"SELF_DECLARED_ADULT"',
    'status == "VERIFIED_ADULT"',
    '"EXTERNAL_PROVIDER"',
    '"MANUAL_REVIEW"',
    'currentUserHasRegistrationAgeEligibility',
    'canonicalOwnerLifecycleAllowsPublicMediaExposure',
    'currentUserCanUseAdultSocialPlatform',
  ],
  'Rules devem exigir admissão canônica 18+ e lifecycle no uso normal'
);

requireAll(
  'firestore-rules/users.rules',
  ['currentUserHasRegistrationAgeEligibility()'],
  'conclusão do cadastro deve exigir 18+ canônico'
);

const helperSource = codeOnly(read('firestore-rules/_helpers.rules'));

const registrationFunction = helperSource.match(
  /function canonicalAgeEligibilityAllowsRegistration\(userId\)\s*\{([\s\S]*?)\n\s*\}/
)?.[1] ?? '';

if (!registrationFunction.includes('SELF_DECLARED_ADULT') ||
    !registrationFunction.includes('"SELF_DECLARATION"') ||
    !registrationFunction.includes('"decidedAt"') ||
    !registrationFunction.includes('canonicalAgeEligibilityAllowsTrustedAdultAccess')) {
  violations.push('firestore-rules/_helpers.rules (admissão 18+ canônica incompleta)');
}

for (const functionName of [
  'currentUserCanUseAdultSocialPlatform',
  'canonicalOwnerLifecycleAllowsPublicMediaExposure',
]) {
  const body = helperSource.match(
    new RegExp(
      'function\\s+' +
        functionName +
        '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}'
    )
  )?.[1] ?? '';

  if (!body) {
    violations.push(
      `firestore-rules/_helpers.rules (função obrigatória não localizada: ${functionName})`
    );
    continue;
  }

  if (body.includes('canonicalAgeEligibilityAllowsTrustedAdultAccess')) {
    violations.push(
      `firestore-rules/_helpers.rules (${functionName} não pode reinterpretar assurance etário)`
    );
  }
}

// -----------------------------------------------------------------------------
// Account Access / lifecycle é a autoridade de produto após admissão
// -----------------------------------------------------------------------------

requireAll(
  'functions/src/account_lifecycle/interaction-access.policy.ts',
  [
    'assertPlatformAccountAccessData',
    'accountStatus',
    'interactionBlocked',
    'acceptedTerms',
    'adultConsent',
    'accessExpiresAtMs',
  ],
  'Account Access deve centralizar lifecycle/legal'
);

forbidAll(
  'functions/src/account_lifecycle/interaction-access.policy.ts',
  [
    'age_eligibility_records',
    'evaluateCanonicalAgeEligibility',
    'isTrustedAdultAgeDecision',
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
  ],
  'uso normal da conta ativa não pode revalidar assurance etário'
);

const productDomainDirectories = [
  'functions/src/media',
  'functions/src/discovery',
  'functions/src/community',
  'functions/src/friendship',
  'functions/src/promotion-boost',
  'functions/src/community-boost',
  'functions/src/chat',
].map((item) => path.join(root, item));

for (const directory of productDomainDirectories) {
  for (const file of walk(directory, ['.ts'])) {
    const relative = path.normalize(path.relative(root, file));
    const source = codeOnly(fs.readFileSync(file, 'utf8'));

    for (const token of [
      'age_eligibility_records',
      'evaluateCanonicalAgeEligibility',
      'isTrustedAdultAgeDecision',
      'resolveCurrentTrustedAdultAgeProjection',
      'trusted-adult-account-assurance.policy',
    ]) {
      if (source.includes(token)) {
        violations.push(
          `${relative} (produto não pode interpretar autoridade etária: ${token})`
        );
      }
    }
  }
}

for (const relativePath of [
  'functions/src/media/application/media-authoring-eligibility.service.ts',
  'functions/src/media/application/public-media-consumption-access.policy.ts',
  'functions/src/discovery/get-public-profiles-page.handler.ts',
  'functions/src/discovery/get-user-intent-statuses.handler.ts',
]) {
  requireAll(
    relativePath,
    ['assertInteractionAccess'],
    'produto deve delegar autorização à Account Access'
  );
}

forbidAll(
  'firestore-rules/public_profiles_next.rules',
  ['canonicalAgeEligibilityAllowsTrustedAdultAccess'],
  'projeção pública de conta já ativa não pode revalidar assurance etário'
);

// Os deadlines vivem na política reutilizada por mídias públicas e privadas.
// O alias público continua obrigatório para compatibilidade dos consumidores.
requireAll(
  'functions/src/media/application/authorized-media-signed-url-expiry.policy.ts',
  [
    'resolveAuthorizedMediaSignedUrlExpiresAt',
    'requesterAccessExpiresAtMs',
    'ownerAccessExpiresAtMs',
    'technicalExpiresAtMs',
  ],
  'URL temporária deve respeitar deadline genérico de Account Access'
);

requireAll(
  'functions/src/media/application/public-media-signed-url-expiry.policy.ts',
  [
    'resolveAuthorizedMediaSignedUrlExpiresAt',
    'resolvePublicMediaSignedUrlExpiresAt',
  ],
  'alias público deve delegar à política compartilhada'
);

forbidAll(
  'functions/src/media/application/authorized-media-signed-url-expiry.policy.ts',
  ['ageEligibility', 'VERIFIED_ADULT', 'SELF_DECLARED_ADULT'],
  'Media não pode conhecer a razão etária do deadline'
);

forbidAll(
  'functions/src/media/application/public-media-signed-url-expiry.policy.ts',
  ['ageEligibility', 'VERIFIED_ADULT', 'SELF_DECLARED_ADULT'],
  'Media não pode conhecer a razão etária do deadline'
);

// -----------------------------------------------------------------------------
// Media: distribuição e segurança de conteúdo não recebem assurance do autor
// -----------------------------------------------------------------------------

for (const relativePath of [
  'functions/src/media/application/public-media-exposure.policy.ts',
  'functions/src/media/application/public-media-owner-exposure.service.ts',
  'functions/src/media/application/media-authoring-eligibility.service.ts',
  'functions/src/media/application/public-media-consumption-access.policy.ts',
  'functions/src/media/application/media-content-safety-assessment.policy.ts',
]) {
  forbidAll(relativePath, [
    'ageEligibilityVerifiedAdult',
    'ageEligibilityAssurance',
    'ageEligibilityValidUntil',
    'isTrustedAdultAgeDecision',
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
  ], 'Media não pode decidir autoria, exposição ou segurança com assurance da conta');
}

requireAll(
  'functions/src/media/application/public-media-exposure.policy.ts',
  ['canonicalOwnerLifecycleAllowed', 'moderationStatus', 'viewerBlocked'],
  'distribuição de Media usa lifecycle, audiência e moderação'
);

requireAll(
  'functions/src/media/application/media-content-safety-assessment.policy.ts',
  ['POSSIBLE_MINOR', 'CONFIRMED_MINOR', 'UNASSESSED'],
  'segurança de menor no conteúdo tem autoridade independente'
);

// Media does not use account assurance as publication or distribution authority.
for (const relativePath of [
  'functions/src/media/application/public-media-exposure.policy.ts',
  'functions/src/media/application/public-media-owner-exposure.service.ts',
  'functions/src/media/application/media-authoring-eligibility.service.ts',
  'functions/src/media/application/public-media-consumption-access.policy.ts',
  'functions/src/media/application/media-content-safety-assessment.policy.ts',
]) {
  forbidAll(relativePath, [
    'ageEligibilityVerifiedAdult', 'ageEligibilityAssurance', 'ageEligibilityValidUntil',
    'isTrustedAdultAgeDecision', 'SELF_DECLARED_ADULT', 'VERIFIED_ADULT',
  ], 'Media não pode reinterpretar assurance etário');
}
requireAll(
  'functions/src/media/application/media-content-safety-assessment.policy.ts',
  ['POSSIBLE_MINOR', 'CONFIRMED_MINOR', 'UNASSESSED'],
  'segurança de menores em conteúdo é independente de assurance'
);

// -----------------------------------------------------------------------------
// Frontend: onboarding pode reconciliar idade; produto ativo usa lifecycle
// -----------------------------------------------------------------------------

forbidAll(
  'src/app/core/services/media/public-media-read-boundary.service.ts',
  [
    'AgeEligibilityService',
    'VERIFIED_ADULT',
    'SELF_DECLARED_ADULT',
    '/adulto/verificar-idade',
  ],
  'cliente Media não pode criar preflight etário próprio'
);

const frontendProductDirectories = [
  'src/app/media',
  'src/app/community',
  'src/app/dashboard/online',
  'src/app/dashboard/discovery',
  'src/app/explore',
  'src/app/chat-module',
].map((item) => path.join(root, item));

for (const directory of frontendProductDirectories) {
  for (const file of walk(directory, ['.ts'])) {
    const relative = path.normalize(path.relative(root, file));
    const source = codeOnly(fs.readFileSync(file, 'utf8'));

    for (const token of [
      'AgeEligibilityService',
      'isCurrentTrustedAdultAgeProjection',
      'SELF_DECLARED_ADULT',
      'VERIFIED_ADULT',
    ]) {
      if (source.includes(token)) {
        violations.push(
          `${relative} (frontend de produto não pode interpretar assurance: ${token})`
        );
      }
    }
  }
}

requireAll(
  'src/app/core/services/autentication/auth/access-control.service.ts',
  ['accountStatus$', 'isLifecycleBlocked$', 'canUseAdultSocial$', 'canEnterCore$'],
  'AccessControl deve consumir lifecycle da conta'
);

forbidAll(
  'src/app/core/services/autentication/auth/access-control.service.ts',
  [
    'trustedAdultAssuranceAllowed$',
    'resolveTrustedAdultAgeProjection',
    'isCurrentTrustedAdultAgeProjection',
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
  ],
  'runtime do produto não pode reinterpretar assurance etário'
);

requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentAdultAccountAdmissionProjection',
    '/adulto/verificar-idade',
    'profileCompleted',
    'normalizeUserAccountLifecycleStatus',
    "=== 'active'",
  ],
  'guard adulto deve reconciliar idade somente na admissão e usar lifecycle depois'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentAdultAccountAdmissionProjection',
  ],
  'onboarding deve exigir admissão canônica 18+'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'acceptSelfDeclaration$',
    'confirmAdult()',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentAdultAccountAdmissionProjection',
  ],
  'tela etária deve admitir 18+ declarado uma vez'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['isTrustedAdultAgeDecision'],
  'tela não deve exigir assurance forte no cadastro'
);

// -----------------------------------------------------------------------------
// Reverificação por fato novo e expiração técnica
// -----------------------------------------------------------------------------

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'SELF_DECLARATION'"],
  'admissão 18+ autodeclarada deve ser o padrão'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isAdultAccountAdmissionDecision'],
  'consentimento deve seguir decisão canônica 18+'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
);

requireAll(
  'functions/src/compliance/request-profile-age-reverification.handler.ts',
  ['buildAgeReviewRestrictionPatch'],
  'fato novo de segurança deve materializar restrição no lifecycle'
);

requireAll(
  'functions/src/compliance/review-profile-age-reverification.handler.ts',
  ['buildAgeReviewRestorePatch', 'buildConfirmedUnderageSuspensionPatch'],
  'decisão de reverificação deve restaurar ou suspender via lifecycle'
);

requireAll(
  'functions/src/compliance/age-verification-provider-assertion.trigger.ts',
  ['buildConfirmedUnderageSuspensionPatch'],
  'assertion confiável de menoridade deve repercutir no lifecycle'
);

for (const relativePath of [
  'functions/src/compliance/request-profile-age-reverification.handler.ts',
  'functions/src/compliance/review-profile-age-reverification.handler.ts',
]) {
  forbidAll(
    relativePath,
    [
      'profile-age-reverification-media',
      'hideProfileMediaVisibility',
      'restoreProfileMediaVisibility',
    ],
    'revalidação deve atuar pela conta, não mutar Media'
  );
}

forbidAll(
  'functions/src/compliance/expire-age-eligibility.service.ts',
  [
    'buildAgeReviewRestrictionPatch',
    'buildConfirmedUnderageSuspensionPatch',
    'interactionBlocked',
    'publicVisibility',
    'moderation_suspended',
  ],
  'expiração técnica de assurance não pode bloquear lifecycle sozinha'
);

requireAll(
  'functions/src/moderation/moderation-safety-notification.service.ts',
  [
    'Registro de verificação atualizado',
    'Isso não altera sozinho o acesso de uma conta já admitida.',
    'actionRequired: false',
  ],
  'notificação de expiração deve ser informativa e não bloqueante'
);

forbidAll(
  'src/app/app-routing.module.ts',
  ['ageEligibilityGuard', 'ageReverificationGuard'],
  'roteamento não deve duplicar gate etário por feature'
);

for (const relativePath of [
  'src/app/core/services/media/media-error.catalog.ts',
  'src/app/core/services/media/public-media-callable-feedback.policy.ts',
]) {
  forbidAll(
    relativePath,
    [
      'AGE_VERIFICATION_REQUIRED',
      'AGE_REVERIFICATION_REQUIRED',
      '/adulto/verificar-idade',
      '/adulto/revalidar',
    ],
    'Media não deve apresentar fluxo etário próprio'
  );
}

const unique = [...new Set(violations)].sort();

if (unique.length > 0) {
  console.error('[age-authority] Fronteira canônica violada:');
  for (const violation of unique) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(
  '[age-authority] OK: admissão 18+ canônica; assurance forte é independente do uso; Media usa lifecycle e segurança de conteúdo.'
);
