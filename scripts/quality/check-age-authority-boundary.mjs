// scripts/quality/check-age-authority-boundary.mjs
// -----------------------------------------------------------------------------
// AGE AUTHORITY BOUNDARY CHECK
// -----------------------------------------------------------------------------
// Contrato:
// - age_eligibility_records/{uid} é autoridade backend-only da decisão etária;
// - users/{uid}.ageEligibility é projeção de UX/assurance;
// - SELF_DECLARED_ADULT e VERIFIED_ADULT não são gates de Media/Discovery;
// - consequências de menoridade/revalidação chegam às superfícies pelo lifecycle;
// - segurança de possível menor no conteúdo pertence à moderação de Media.
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

// A autoridade etária permanece backend-only e distinta de consentimento.
requireAll(
  'functions/src/compliance/age-eligibility.policy.ts',
  [
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
    'DENIED_UNDERAGE',
  ],
  'policy etária canônica incompleta'
);

requireAll(
  'functions/src/compliance/age-eligibility.service.ts',
  ['age_eligibility_records'],
  'serviço etário deve persistir na coleção canônica'
);

requireAll(
  'src/app/core/services/compliance/age-eligibility.service.ts',
  [
    'SELF_DECLARED_ADULT',
    'VERIFIED_ADULT',
    'trustedSessionProjection',
  ],
  'cliente deve preservar projeção de assurance'
);

// Firestore só pode consultar a autoridade etária no fechamento do cadastro.
// Superfícies normais recebem qualquer consequência pelo lifecycle da conta.
for (const relativePath of [
  'firestore-rules/public_index.rules',
  'firestore-rules/public_profiles_next.rules',
  'firestore-rules/public_profiles_photos.rules',
  'firestore-rules/public_profiles_videos.rules',
  'firestore-rules/user_intent_statuses.rules',
  'firestore-rules/friendRequests.rules',
  'firestore-rules/friends_root.rules',
  'firestore-rules/public_social_links.rules',
  'firestore-rules/presence.rules',
]) {
  forbidAll(
    relativePath,
    [
      'canonicalAgeEligibilityAllowsAdultAccess',
      'canonicalAgeEligibilityIsVerifiedAdult',
      'currentUserHasAdultAgeAccess',
      'currentUserHasVerifiedAdultAge',
      'publicAgeProjectionAllowsAdultExposure',
    ],
    'superfície fora de Account não pode revalidar assurance etário'
  );
}

forbidAll(
  'firestore-rules/_helpers.rules',
  [
    'adultMediaAgeReverificationAllowsAccess',
    'publicAgeProjectionAllowsAdultExposure',
    'canonicalAgeEligibilityIsVerifiedAdult',
    'currentUserHasVerifiedAdultAge',
  ],
  'helper etário sem consumidor não deve permanecer como autoridade latente'
);

requireAll(
  'firestore-rules/users.rules',
  ['currentUserHasAdultAgeAccess()'],
  'conclusão do cadastro deve consultar a autoridade etária da conta'
);

const ageRules = read('firestore-rules/age_eligibility_records.rules');
if (
  ageRules &&
  !/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(ageRules)
) {
  violations.push(
    'firestore-rules/age_eligibility_records.rules (autoridade etária deve permanecer backend-only)'
  );
}

// O legado ageVerification não pode voltar a conceder autorização fora do
// fluxo explícito de cadastro/compliance. O nome da etapa de registro continua
// válido como navegação/UX e não representa autoridade de Media.
for (const directory of [
  path.join(root, 'functions', 'src'),
  path.join(root, 'src', 'app'),
]) {
  for (const file of walk(directory, ['.ts'])) {
    const relative = path.normalize(path.relative(root, file));
    const allowedAgeVerificationNaming = [
      'src/app/core/services/autentication/auth/age-verification.service.ts',
      'src/app/app-routing.module.ts',
      'src/app/register-module/data-access/register-flow.model.ts',
      'src/app/register-module/data-access/register-navigation.service.ts',
    ].map((item) => path.normalize(item));

    if (allowedAgeVerificationNaming.includes(relative)) {
      continue;
    }

    const source = codeOnly(fs.readFileSync(file, 'utf8'));
    if (/\bageVerification\b/.test(source)) {
      violations.push(
        `${relative} (ageVerification legado não pode ser autoridade)`
      );
    }
  }
}

// Conta/lifecycle é a fronteira das superfícies normais.
requireAll(
  'functions/src/account_lifecycle/interaction-access.policy.ts',
  [
    'assertPlatformAccountAccessData',
    'accountStatus',
    'suspended',
    'interactionBlocked',
    'TERMS_ACCEPTANCE_VERSION',
    'ADULT_CONSENT_VERSION',
  ],
  'fronteira de conta incompleta'
);
forbidAll(
  'functions/src/account_lifecycle/interaction-access.policy.ts',
  [
    'evaluateCanonicalAgeEligibility',
    "collection('age_eligibility_records')",
    'isVerifiedAdultAgeDecision',
  ],
  'interação não deve duplicar a decisão etária'
);

requireAll(
  'src/app/core/services/autentication/auth/access-control.service.ts',
  [
    'canUseAdultSocial$',
    'moderationInteractionAllowed$',
    'TERMS_ACCEPTANCE_VERSION',
    'ADULT_CONSENT_VERSION',
  ],
  'runtime social deve usar lifecycle/consentimento'
);
forbidAll(
  'src/app/core/services/autentication/auth/access-control.service.ts',
  [
    'this.ageEligibility.adultAccessAllowed$',
    'this.ageEligibility.verifiedAdult$',
  ],
  'runtime social não deve reavaliar assurance etário'
);

// O roteamento normal não pode transformar assurance/revalidação em gate.
requireAll(
  'src/app/app-routing.module.ts',
  ['accountLifecycleGuard'],
  'roteamento normal deve preservar lifecycle como fronteira de conta'
);
forbidAll(
  'src/app/app-routing.module.ts',
  [
    'ageEligibilityGuard',
    'ageReverificationGuard',
  ],
  'rotas normais não podem reintroduzir gate de assurance etário'
);

// Media: consumo e autoria dependem da conta, nunca do assurance.
requireAll(
  'functions/src/media/application/media-authoring-eligibility.service.ts',
  ['assertPlatformAccountAccessData'],
  'autoria Media deve usar a fronteira de conta'
);
forbidAll(
  'functions/src/media/application/media-authoring-eligibility.service.ts',
  [
    'age_eligibility_records',
    'evaluateCanonicalAgeEligibility',
    'isVerifiedAdultAgeDecision',
  ],
  'autoria Media não pode reavaliar idade'
);

requireAll(
  'functions/src/media/application/public-media-consumption-access.policy.ts',
  ['assertPlatformAccountAccessData'],
  'consumo Media deve usar a fronteira de conta'
);
forbidAll(
  'functions/src/media/application/public-media-consumption-access.policy.ts',
  [
    'age_eligibility_records',
    'evaluateCanonicalAgeEligibility',
    'isVerifiedAdultAgeDecision',
  ],
  'consumo Media não pode reavaliar idade'
);

forbidAll(
  'src/app/core/services/media/public-media-read-boundary.service.ts',
  [
    'AgeEligibilityService',
    'verifiedAdult$',
    'adultAccessAllowed$',
    'if (!verifiedAdult)',
  ],
  'cliente Media não pode criar preflight etário'
);

for (const relativePath of [
  'functions/src/media/application/manage-photo-publication.handler.ts',
  'functions/src/media/application/manage-video-publication.handler.ts',
]) {
  requireAll(
    relativePath,
    [
      'assertMediaAuthoringEligibility',
      'ageEligibilityVerifiedAdult: FieldValue.delete()',
      'ageEligibilityAssurance: FieldValue.delete()',
      'ageEligibilityValidUntil: FieldValue.delete()',
    ],
    'publicação deve limpar projeções etárias legadas'
  );
  forbidAll(
    relativePath,
    [
      'ageEligibilityVerifiedAdult: true',
      'evaluateCanonicalAgeEligibility',
      'isVerifiedAdultAgeDecision',
    ],
    'mídia publicada não pode carregar autoridade etária'
  );
}

requireAll(
  'functions/src/media/application/public-media-exposure.policy.ts',
  [
    'evaluatePublicMediaOwnerExposure',
    'evaluatePublicMediaSignedOwnerExposure',
    'isCurrentPublicMediaProjectionExposure',
    'isCurrentPublicMediaAssetExposure',
    'BILATERAL_BLOCK',
    'APPROVED',
  ],
  'exposure Media incompleto'
);
forbidAll(
  'functions/src/media/application/public-media-exposure.policy.ts',
  [
    'publicAgeProjectionValidUntilMs',
    'OWNER_AGE_',
    'ageEligibilityVerifiedAdult',
    'ageEligibilityValidUntil',
  ],
  'exposure Media não pode depender da idade do owner'
);

requireAll(
  'functions/src/media/application/public-media-owner-exposure.service.ts',
  [
    "db.doc(`users/\${ownerUid}`)",
    "db.doc(`public_profiles/\${ownerUid}`)",
    'evaluateCanonicalOwnerLifecycle',
  ],
  'owner exposure deve consultar lifecycle'
);
forbidAll(
  'functions/src/media/application/public-media-owner-exposure.service.ts',
  [
    'age_eligibility_records',
    'evaluateCanonicalAgeEligibility',
  ],
  'owner exposure não pode consultar autoridade etária'
);

for (const relativePath of [
  'functions/src/media/application/get-public-photo-access-urls.handler.ts',
  'functions/src/media/application/get-public-video-access-urls.handler.ts',
]) {
  requireAll(
    relativePath,
    [
      'assertPublicMediaConsumptionAccess',
      'resolvePublicMediaSignedOwnerExposure',
      'resolvePublicMediaSignedUrlExpiresAt',
    ],
    'URL assinada deve preservar conta/lifecycle e TTL técnico'
  );
  forbidAll(
    relativePath,
    [
      'ageEligibilityExpiresAtMs',
      'publicAgeProjectionValidUntilMs',
      'viewerExpiresAt',
      'ownerExpiresAt',
      'mediaValidUntilMs',
    ],
    'URL assinada não pode ter TTL etário'
  );
}

requireAll(
  'functions/src/media/application/public-media-signed-url-expiry.policy.ts',
  ['technicalExpiresAtMs'],
  'TTL temporário deve preservar limite técnico'
);
forbidAll(
  'functions/src/media/application/public-media-signed-url-expiry.policy.ts',
  [
    'viewerExpiresAtMs',
    'ownerExpiresAtMs',
    'mediaExpiresAtMs',
    'ageEligibility',
  ],
  'TTL temporário não pode depender de idade'
);

for (const relativePath of [
  'firestore-rules/public_profiles_photos.rules',
  'firestore-rules/public_profiles_videos.rules',
]) {
  requireAll(
    relativePath,
    [
      'canConsumeAdultPublicMedia()',
      'canonicalOwnerLifecycleAllowsPublicMediaExposure(userId)',
      'moderationStatus == "APPROVED"',
    ],
    'Rules de Media devem preservar lifecycle e moderação'
  );
  forbidAll(
    relativePath,
    [
      'canonicalAgeEligibilityAllowsAdultAccess(userId)',
      'ageEligibilityAdultAccessAllowed == true',
      'publicAgeProjectionAllowsAdultExposure',
    ],
    'Rules de Media não podem reavaliar idade'
  );
}

// Outras superfícies sociais também não consultam a autoridade etária.
for (const relativePath of [
  'functions/src/community/community-social-access.service.ts',
  'functions/src/friendship/application/get-pending-friend-requests.handler.ts',
]) {
  forbidAll(
    relativePath,
    [
      "collection('age_eligibility_records')",
      'evaluateCanonicalAgeEligibility',
      'VERIFIED_ADULT',
    ],
    'superfície social não pode duplicar a decisão etária'
  );
}

// Segurança de menor dentro do conteúdo é uma autoridade de moderação de Media.
requireAll(
  'functions/src/media/application/media-report-safety.ts',
  [
    'minor_exposure_safety',
    'minor_content_safety',
    'MAXIMUM_MINOR',
    'shouldQuarantineMediaAfterReport',
  ],
  'Media deve preservar a fronteira crítica de segurança de menor no conteúdo'
);

// Discovery geral segue a mesma arquitetura de conta.
for (const relativePath of [
  'functions/src/discovery/get-public-profiles-page.handler.ts',
  'functions/src/discovery/get-user-intent-statuses.handler.ts',
]) {
  requireAll(
    relativePath,
    ['assertInteractionAccess', 'Date.now()'],
    'discovery deve validar o viewer pela conta'
  );
  forbidAll(
    relativePath,
    [
      "where('ageEligibilityVerifiedAdult'",
      "data['ageEligibilityVerifiedAdult']",
      "data['ageEligibilityValidUntil']",
    ],
    'discovery não pode filtrar por assurance etário'
  );
}

forbidAll(
  'functions/src/discovery/user-intent-status.handler.ts',
  [
    'evaluateCanonicalAgeEligibility',
    'isVerifiedAdultAgeDecision',
    "collection('age_eligibility_records')",
    'ageEligibilityVerifiedAdult: true',
  ],
  'publicação de intenção não pode exigir verificação forte'
);

forbidAll(
  'functions/src/discovery/sync-public-profile-discovery.handler.ts',
  [
    'evaluateCanonicalAgeEligibility',
    "collection('age_eligibility_records')",
    'ageEligibilityVerifiedAdult: true',
  ],
  'perfil público não pode depender de assurance etário'
);

for (const relativePath of [
  'firestore-rules/public_profiles_next.rules',
  'firestore-rules/user_intent_statuses.rules',
]) {
  forbidAll(
    relativePath,
    [
      'canonicalAgeEligibilityAllowsAdultAccess',
      'canonicalAgeEligibilityIsVerifiedAdult',
      'ageEligibilityVerifiedAdult == true',
      'ageEligibilityValidUntil',
    ],
    'Rules de discovery não podem reavaliar assurance etário'
  );
}

// Media não pode reintroduzir assurance etário como razão/apresentação própria.
forbidAll(
  'src/app/core/services/media/media-error.catalog.ts',
  [
    'AGE_VERIFICATION_REQUIRED',
    'AGE_REVERIFICATION_REQUIRED',
    'age_reverification_required',
    'verification_required',
    'verification_expired',
    'record_mismatch',
    'policy_outdated',
    '/adulto/verificar-idade',
    '/adulto/revalidar',
  ],
  'catálogo Media não pode apresentar gate etário'
);

forbidAll(
  'src/app/core/services/media/public-media-callable-feedback.policy.ts',
  [
    'AGE_VERIFICATION_REQUIRED',
    'AGE_REVERIFICATION_REQUIRED',
    'age_reverification_required',
    'verification_required',
    'verification_expired',
    'record_mismatch',
    'policy_outdated',
    '/adulto/verificar-idade',
    '/adulto/revalidar',
  ],
  'feedback Media não pode apresentar gate etário'
);

// Enumeração pública continua backend-only.
for (const relativePath of [
  'firestore-rules/public_profiles_next.rules',
  'firestore-rules/user_intent_statuses.rules',
  'firestore-rules/public_profiles_photos.rules',
  'firestore-rules/public_profiles_videos.rules',
]) {
  const source = read(relativePath);
  if (source && !/allow\s+list\s*:\s*if\s+false\s*;/.test(source)) {
    violations.push(
      `${relativePath} (listagem pública deve permanecer backend-only)`
    );
  }
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
  '[age-authority] OK: maioridade pertence à conta; assurance permanece backend-only/UX e Media/Discovery usam lifecycle + moderação sem segundo gate etário.'
);
