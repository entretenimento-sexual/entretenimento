// scripts/quality/check-age-authority-boundary.mjs
// -----------------------------------------------------------------------------
// TRUSTED ADULT ACCOUNT ACCESS BOUNDARY
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

requireAll(
  'functions/src/compliance/age-eligibility.policy.ts',
  [
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
    'DENIED_UNDERAGE',
    'isTrustedAdultAgeDecision',
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
  'serviço etário deve exigir assurance confiável'
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
  'functions/src/account_lifecycle/interaction-access.policy.ts',
  [
    'assertPlatformAccountAccessData',
    'accountStatus',
    'interactionBlocked',
    'accessExpiresAtMs',
  ],
  'Account Access deve centralizar lifecycle/legal sem reinterpretar idade'
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

requireAll(
  'firestore-rules/_helpers.rules',
  [
    'canonicalAgeEligibilityAllowsTrustedAdultAccess',
    'status == "VERIFIED_ADULT"',
    '"EXTERNAL_PROVIDER"',
    '"MANUAL_REVIEW"',
    'currentUserHasRegistrationAgeEligibility',
    'canonicalOwnerLifecycleAllowsPublicMediaExposure',
    'currentUserCanUseAdultSocialPlatform',
  ],
  'Rules devem exigir assurance na admissão e lifecycle no uso normal'
);

requireAll(
  'firestore-rules/users.rules',
  ['currentUserHasRegistrationAgeEligibility()'],
  'conclusão do cadastro deve exigir maioridade confiável'
);

const helperSource = codeOnly(read('firestore-rules/_helpers.rules'));

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

  if (body.includes('canonicalAgeEligibilityAllowsTrustedAdultAccess')) {
    violations.push(
      `firestore-rules/_helpers.rules (${functionName} não pode reinterpretar assurance etário)`
    );
  }
}
const registrationFunction = helperSource.match(
  /function canonicalAgeEligibilityAllowsRegistration\(userId\)\s*\{([\s\S]*?)\n\s*\}/
)?.[1] ?? '';
if (registrationFunction.includes('SELF_DECLARED_ADULT')) {
  violations.push(
    'firestore-rules/_helpers.rules (SELF_DECLARED_ADULT não pode liberar cadastro)'
  );
}

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

requireAll(
  'functions/src/media/application/public-media-signed-url-expiry.policy.ts',
  [
    'requesterAccessExpiresAtMs',
    'ownerAccessExpiresAtMs',
    'technicalExpiresAtMs',
  ],
  'URL temporária deve respeitar deadline genérico de Account Access'
);

forbidAll(
  'functions/src/media/application/public-media-signed-url-expiry.policy.ts',
  [
    'ageEligibility',
    'VERIFIED_ADULT',
    'SELF_DECLARED_ADULT',
  ],
  'Media não pode conhecer a razão etária do deadline'
);

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
  [
    'accountStatus
requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
    '/adulto/verificar-idade',
  ],
  'guard adulto deve reconciliar silenciosamente apenas durante admissão'
);

requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'profileCompleted',
    'normalizeUserAccountLifecycleStatus',
    "=== 'active'",
  ],
  'conta já admitida deve usar lifecycle, não novo gate etário'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'onboarding deve exigir VERIFIED_ADULT confiável'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'requestInitialReview$',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'tela etária deve usar verificação confiável'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['acceptSelfDeclaration$'],
  'tela não deve pedir autodeclaração novamente'
);

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'VERIFIED_REQUIRED'"],
  'modo padrão não pode admitir por autodeclaração'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'consentimento adulto só pode seguir após maioridade confiável'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
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
  '[age-authority] OK: VERIFIED_ADULT confiável é exigido na admissão; conta ativa usa lifecycle e fatos novos de segurança repercutem pela conta, sem segundo gate etário nos produtos.'
);
,
    'isLifecycleBlocked
requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
    '/adulto/verificar-idade',
  ],
  'guard adulto deve reconciliar silenciosamente'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'onboarding deve exigir VERIFIED_ADULT confiável'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'requestInitialReview$',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'tela etária deve usar verificação confiável'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['acceptSelfDeclaration$'],
  'tela não deve pedir autodeclaração novamente'
);

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'VERIFIED_REQUIRED'"],
  'modo padrão não pode admitir por autodeclaração'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'consentimento adulto só pode seguir após maioridade confiável'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
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
  '[age-authority] OK: VERIFIED_ADULT confiável é revalidado por Account Access/Rules; autodeclaração não autoriza e produtos não interpretam idade.'
);
,
    'canUseAdultSocial
requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
    '/adulto/verificar-idade',
  ],
  'guard adulto deve reconciliar silenciosamente'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'onboarding deve exigir VERIFIED_ADULT confiável'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'requestInitialReview$',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'tela etária deve usar verificação confiável'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['acceptSelfDeclaration$'],
  'tela não deve pedir autodeclaração novamente'
);

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'VERIFIED_REQUIRED'"],
  'modo padrão não pode admitir por autodeclaração'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'consentimento adulto só pode seguir após maioridade confiável'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
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
  '[age-authority] OK: VERIFIED_ADULT confiável é revalidado por Account Access/Rules; autodeclaração não autoriza e produtos não interpretam idade.'
);
,
    'canEnterCore
requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
    '/adulto/verificar-idade',
  ],
  'guard adulto deve reconciliar silenciosamente'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'onboarding deve exigir VERIFIED_ADULT confiável'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'requestInitialReview$',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'tela etária deve usar verificação confiável'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['acceptSelfDeclaration$'],
  'tela não deve pedir autodeclaração novamente'
);

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'VERIFIED_REQUIRED'"],
  'modo padrão não pode admitir por autodeclaração'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'consentimento adulto só pode seguir após maioridade confiável'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
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
  '[age-authority] OK: VERIFIED_ADULT confiável é revalidado por Account Access/Rules; autodeclaração não autoriza e produtos não interpretam idade.'
);
,
  ],
  'AccessControl deve consumir lifecycle da conta'
);

forbidAll(
  'src/app/core/services/autentication/auth/access-control.service.ts',
  [
    'trustedAdultAssuranceAllowed
requireAll(
  'src/app/core/guards/compliance/adult-content-consent.guard.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
    '/adulto/verificar-idade',
  ],
  'guard adulto deve reconciliar silenciosamente'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'onboarding deve exigir VERIFIED_ADULT confiável'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'requestInitialReview$',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'tela etária deve usar verificação confiável'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['acceptSelfDeclaration$'],
  'tela não deve pedir autodeclaração novamente'
);

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'VERIFIED_REQUIRED'"],
  'modo padrão não pode admitir por autodeclaração'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'consentimento adulto só pode seguir após maioridade confiável'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
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
  '[age-authority] OK: VERIFIED_ADULT confiável é revalidado por Account Access/Rules; autodeclaração não autoriza e produtos não interpretam idade.'
);
,
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
    'isCurrentTrustedAdultAgeProjection',
    '/adulto/verificar-idade',
  ],
  'guard adulto deve reconciliar silenciosamente'
);

requireAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  [
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'onboarding deve exigir VERIFIED_ADULT confiável'
);

forbidAll(
  'src/app/register-module/data-access/register-flow.facade.ts',
  ["state.status === 'SELF_DECLARED_ADULT'"],
  'autodeclaração não pode liberar onboarding'
);

requireAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  [
    'requestInitialReview$',
    'reconcileTrustedStateOncePerSession$',
    'isCurrentTrustedAdultAgeProjection',
  ],
  'tela etária deve usar verificação confiável'
);

forbidAll(
  'src/app/compliance/age-verification-page/age-verification-page.component.ts',
  ['acceptSelfDeclaration$'],
  'tela não deve pedir autodeclaração novamente'
);

requireAll(
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  ["AGE_ADMISSION_MODE ?? 'VERIFIED_REQUIRED'"],
  'modo padrão não pode admitir por autodeclaração'
);

requireAll(
  'functions/src/compliance/adult-consent.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'consentimento adulto só pode seguir após maioridade confiável'
);

requireAll(
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  ['isTrustedAdultAgeDecision'],
  'review inicial não pode ser dispensado por autodeclaração'
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
  '[age-authority] OK: VERIFIED_ADULT confiável é revalidado por Account Access/Rules; autodeclaração não autoriza e produtos não interpretam idade.'
);
