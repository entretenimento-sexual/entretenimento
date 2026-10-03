// scripts/quality/check-age-authority-boundary.mjs
// -----------------------------------------------------------------------------
// AGE AUTHORITY BOUNDARY CHECK
// -----------------------------------------------------------------------------
// Protege a separação global:
// - age_eligibility_records/{uid} é a autoridade etária backend-only;
// - users/{uid}.ageEligibility é somente projeção sanitizada;
// - adultConsent é consentimento e nunca prova de idade;
// - ageReverification é processo/caso e não substitui a autoridade canônica;
// - users/{uid}.ageVerification é legado e não pode voltar a conceder acesso.
// - users/{uid}.idade é dado social de perfil e nunca prova de maioridade.
//
// O identificador legado só pode existir:
// - no serviço Angular de compatibilidade fail-closed;
// - em users.rules para bloquear criação/alteração client-side;
// - em testes/limpezas explicitamente fora deste scanner.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

const requiredFiles = Object.freeze([
  'functions/src/compliance/age-eligibility.policy.ts',
  'functions/src/compliance/age-eligibility.service.ts',
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  'functions/src/compliance/age-verification-provider-assertion.policy.ts',
  'functions/src/compliance/age-verification-provider-assertion.trigger.ts',
  'functions/src/compliance/age-review-evidence.policy.ts',
  'functions/src/compliance/request-initial-age-verification-review.handler.ts',
  'functions/src/compliance/review-initial-age-verification.handler.ts',
  'functions/src/compliance/review-profile-age-reverification.handler.ts',
  'functions/src/compliance/appeal-profile-age-reverification.handler.ts',
  'functions/src/compliance/report-profile-minor-safety.handler.ts',
  'functions/src/moderation/moderation-reporter-abuse.policy.ts',
  'functions/src/moderation/moderation-reporter-abuse.service.ts',
  'functions/src/compliance/adult-consent.handler.ts',
  'src/app/core/services/compliance/age-eligibility.service.ts',
  'src/app/core/guards/compliance/age-eligibility.guard.ts',
  'firestore-rules/age_eligibility_records.rules',
  'functions/src/discovery/get-public-profiles-page.handler.ts',
  'functions/src/discovery/get-user-intent-statuses.handler.ts',
  'functions/src/media/application/get-public-media-discovery.handler.ts',
  'functions/src/media/application/public-media-exposure.policy.ts',
  'functions/src/media/application/public-media-owner-exposure.service.ts',
  'src/app/core/services/discovery/public-profile-read-boundary.service.ts',
  'src/app/core/services/media/public-media-read-boundary.service.ts',
  'functions/src/friendship/application/get-pending-friend-requests.handler.ts',
  'functions/src/community/get-community-member-roster-page.handler.ts',
  'functions/src/community/get-profile-public-communities.handler.ts',
  'src/app/core/services/geolocation/nearby-profiles-query.gateway.ts',
  'src/app/core/services/interactions/friendship/repo/friends.repo.ts',
  'src/app/core/services/media/media-public-preview-query.service.ts',
]);

const legacyClientCompatibility = path.normalize(
  'src/app/core/services/autentication/auth/age-verification.service.ts'
);
const legacyRulesProtection = path.normalize(
  'firestore-rules/users.rules'
);

function normalizeRelative(absolutePath) {
  return path.normalize(path.relative(root, absolutePath));
}

function walk(directory, extensions) {
  if (!fs.existsSync(directory)) return [];

  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...walk(absolutePath, extensions));
      continue;
    }

    if (
      entry.isFile() &&
      extensions.some((extension) => entry.name.endsWith(extension)) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      found.push(absolutePath);
    }
  }
  return found;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length));
}

function addMatchViolations(violations, absolutePath, source, pattern, reason) {
  for (const match of source.matchAll(pattern)) {
    violations.push(
      `${normalizeRelative(absolutePath)}:${lineOf(source, match.index ?? 0)} (${reason})`
    );
  }
}

const violations = [];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    violations.push(`${relativePath} (fronteira canônica obrigatória ausente)`);
  }
}

const functionsRoot = path.join(root, 'functions', 'src');
for (const absolutePath of walk(functionsRoot, ['.ts'])) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  const scanned = codeOnly(source);

  addMatchViolations(
    violations,
    absolutePath,
    scanned,
    /\bageVerification\b/g,
    'Functions não podem ler/escrever o legado ageVerification'
  );
}

const socialAgeMustNotAuthorize = Object.freeze([
  'functions/src/compliance/age-eligibility.policy.ts',
  'functions/src/compliance/age-eligibility.service.ts',
  'functions/src/compliance/accept-adult-self-declaration.handler.ts',
  'functions/src/compliance/refresh-my-age-eligibility.handler.ts',
  'src/app/core/services/compliance/age-eligibility.service.ts',
  'src/app/core/guards/compliance/age-eligibility.guard.ts',
]);

for (const relativePath of socialAgeMustNotAuthorize) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const scanned = codeOnly(fs.readFileSync(absolutePath, 'utf8'));
  if (
    /(?:\[['"]idade['"]\]|\.\s*idade\b|\bidade\s*:)/.test(scanned)
  ) {
    violations.push(
      `${relativePath} (idade social não pode participar da autoridade etária)`
    );
  }
}

const angularRoot = path.join(root, 'src', 'app');
for (const absolutePath of walk(angularRoot, ['.ts'])) {
  const relativePath = normalizeRelative(absolutePath);
  if (relativePath === legacyClientCompatibility) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const scanned = codeOnly(source);

  addMatchViolations(
    violations,
    absolutePath,
    scanned,
    /(?:\.\s*ageVerification\b|\b(?:user|data|document|raw|profile|record)\s*\[\s*['"]ageVerification['"]\s*\])/g,
    'Angular não pode acessar users.ageVerification fora da compatibilidade'
  );
  addMatchViolations(
    violations,
    absolutePath,
    scanned,
    /\bageVerification\s*:/g,
    'Angular não pode materializar o campo legado ageVerification'
  );

  addMatchViolations(
    violations,
    absolutePath,
    scanned,
    /collectionGroup\s*\([^)]*['"]public_(?:photos|videos)['"]/g,
    'Angular não pode enumerar mídia pública global; use PublicMediaReadBoundaryService'
  );
  addMatchViolations(
    violations,
    absolutePath,
    scanned,
    /collection\s*\([^)]*['"]user_intent_statuses['"]\s*\)/g,
    'Angular não pode enumerar Status de Hoje; use getUserIntentStatuses'
  );
  addMatchViolations(
    violations,
    absolutePath,
    scanned,
    /collection\s*\([^)]*['"]public_profiles['"]\s*\)/g,
    'Angular não pode enumerar public_profiles; use PublicProfileReadBoundaryService'
  );
}

const rulesRoot = path.join(root, 'firestore-rules');
for (const absolutePath of walk(rulesRoot, ['.rules'])) {
  const relativePath = normalizeRelative(absolutePath);
  const source = fs.readFileSync(absolutePath, 'utf8');

  if (relativePath !== legacyRulesProtection && /\bageVerification\b/.test(source)) {
    violations.push(
      `${relativePath} (Rules não podem usar ageVerification como autoridade)`
    );
  }
}

const legacyDerivedAuthorityPaths = Object.freeze([
  'functions/src/discovery/user-intent-status.handler.ts',
  'functions/src/community/community-social-access.service.ts',
]);

for (const relativePath of legacyDerivedAuthorityPaths) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = codeOnly(fs.readFileSync(absolutePath, 'utf8'));

  for (const [pattern, reason] of [
    [/\[['"]idade['"]\]|\.idade\b/g, 'idade legada não pode alimentar autorização adulta'],
    [/declaredAdult/g, 'autodeclaração adulta não pode alimentar autoridade etária'],
  ]) {
    addMatchViolations(
      violations,
      absolutePath,
      source,
      pattern,
      reason
    );
  }
}

// Discovery pode projetar a idade social declarada para apresentação, mas
// essa projeção nunca pode substituir nem alimentar a decisão 18+ canônica.
const socialAgeProjectionPaths = Object.freeze([
  'functions/src/discovery/sync-public-profile-discovery.handler.ts',
  'functions/src/discovery/backfill-public-profile-discovery.handler.ts',
]);

for (const relativePath of socialAgeProjectionPaths) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = codeOnly(fs.readFileSync(absolutePath, 'utf8'));

  for (const required of [
    'evaluateCanonicalAgeEligibility',
    'resolvePublicProfileAge',
    'ageEligibilityAdultAccessAllowed',
    'ageEligibilityVerifiedAdult',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `${relativePath} (projeção de idade social deve permanecer separada da autoridade canônica: ${required})`
      );
    }
  }

  for (const [pattern, reason] of [
    [
      /ageEligibility(?:AdultAccessAllowed|VerifiedAdult)\s*:\s*resolvePublicProfileAge\s*\(/g,
      'idade social não pode preencher elegibilidade adulta',
    ],
    [
      /\b(?:allowed|adultAccessAllowed|verifiedAdult)\s*[:=]\s*resolvePublicProfileAge\s*\(/g,
      'idade social não pode conceder acesso adulto',
    ],
    [
      /declaredAdult/g,
      'autodeclaração adulta não pode alimentar autoridade etária',
    ],
  ]) {
    addMatchViolations(
      violations,
      absolutePath,
      source,
      pattern,
      reason
    );
  }
}

const legacyServicePath = path.join(root, legacyClientCompatibility);
if (fs.existsSync(legacyServicePath)) {
  const source = fs.readFileSync(legacyServicePath, 'utf8');

  for (const forbidden of [
    'FirestoreWriteService',
    'updateDocument(',
    'setDoc(',
    'updateDoc(',
    'addDoc(',
  ]) {
    if (source.includes(forbidden)) {
      violations.push(
        `${legacyClientCompatibility} (compatibilidade legada não pode persistir: ${forbidden})`
      );
    }
  }

  if (
    !source.includes("isEligible: false") ||
    !source.includes(
      'A verificação etária legada não é fonte válida de autorização.'
    )
  ) {
    violations.push(
      `${legacyClientCompatibility} (legado deve permanecer explicitamente fail-closed)`
    );
  }
}

const ageRecordRulesPath = path.join(
  root,
  'firestore-rules',
  'age_eligibility_records.rules'
);
if (fs.existsSync(ageRecordRulesPath)) {
  const source = fs.readFileSync(ageRecordRulesPath, 'utf8');
  if (!/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(source)) {
    violations.push(
      'firestore-rules/age_eligibility_records.rules (registro canônico deve ser backend-only)'
    );
  }
}

const adultDeclarationRulesPath = path.join(
  root,
  'firestore-rules',
  'age_eligibility_records.rules'
);
if (fs.existsSync(adultDeclarationRulesPath)) {
  const source = fs.readFileSync(adultDeclarationRulesPath, 'utf8');
  if (
    !source.includes('match /adult_self_declarations/{userId}') ||
    !/match\s+\/adult_self_declarations\/\{userId\}[\s\S]*?allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(source)
  ) {
    violations.push(
      'firestore-rules/age_eligibility_records.rules (evidência histórica da autodeclaração deve permanecer backend-only)'
    );
  }
}

const helperPath = path.join(root, 'firestore-rules', '_helpers.rules');
if (fs.existsSync(helperPath)) {
  const source = fs.readFileSync(helperPath, 'utf8');
  for (const required of [
    'canonicalAgeEligibilityAllowsAdultAccess',
    'currentUserHasAdultAgeAccess',
    'currentUserCanUseAdultSocialPlatform',
    'SELF_DECLARED_ADULT',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `firestore-rules/_helpers.rules (helper canônico ausente: ${required})`
      );
    }
  }
}




const publicAgeProjectionPath = path.join(
  root,
  'functions/src/discovery/public-age-eligibility-projection.handler.ts'
);
if (fs.existsSync(publicAgeProjectionPath)) {
  const source = codeOnly(fs.readFileSync(publicAgeProjectionPath, 'utf8'));

  for (const required of [
    '[PUBLIC_AGE_ACCESS_FIELD]: eligible',
    '[PUBLIC_AGE_LEGACY_ACCESS_FIELD]: verified',
    "verified ? 'VERIFIED' : eligible ? 'SELF_DECLARED' : null",
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/discovery/public-age-eligibility-projection.handler.ts (projeção pública deve separar acesso provisório de verificação forte: ${required})`
      );
    }
  }

  if (source.includes('[PUBLIC_AGE_LEGACY_ACCESS_FIELD]: eligible')) {
    violations.push(
      'functions/src/discovery/public-age-eligibility-projection.handler.ts (ageEligibilityVerifiedAdult nunca pode receber elegibilidade provisória)'
    );
  }
}

const selfDeclarationHandlerPath = path.join(
  root,
  'functions/src/compliance/accept-adult-self-declaration.handler.ts'
);
if (fs.existsSync(selfDeclarationHandlerPath)) {
  const source = codeOnly(fs.readFileSync(selfDeclarationHandlerPath, 'utf8'));

  for (const required of [
    "status: 'SELF_DECLARED_ADULT'",
    "source: 'SELF_DECLARATION'",
    "method: 'SELF_DECLARATION'",
    "current.status === 'REVIEW_REQUIRED'",
    "current.status === 'DENIED_UNDERAGE'",
    'writeCanonicalAgeEligibilityInTransaction',
    'projectionFromCanonicalAgeDecision',
    'ageEligibility: projection',
    'compliance_audit',
    'adult_self_declarations',
    'transaction.create(declarationRef',
    'voluntary: true',
    'explicitConfirmation: true',
    'immutable: true',
    'declaredAtMs',
    'declarationTextVersion',
    'exactDeclarationTextCaptured',
    'termsAcceptanceVersion',
    'termsDocumentVersion',
    'privacyNoticeVersion',
    'declarationEvidencePath',
    'findFirstLegacySelfDeclarationAtMs',
    'enforceAppCheck',
    "'VERIFIED_REQUIRED'",
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/accept-adult-self-declaration.handler.ts (autodeclaração provisória deve preservar: ${required})`
      );
    }
  }

  if (/status:\s*['"]VERIFIED_ADULT['"][\s\S]{0,220}confirmsAdult/.test(source)) {
    violations.push(
      'functions/src/compliance/accept-adult-self-declaration.handler.ts (autodeclaração não pode promover diretamente VERIFIED_ADULT)'
    );
  }

  if (
    source.includes('transaction.set(declarationRef') ||
    source.includes('transaction.update(declarationRef')
  ) {
    violations.push(
      'functions/src/compliance/accept-adult-self-declaration.handler.ts (evidência histórica da primeira declaração deve ser create-once e imutável)'
    );
  }
}

const clientAgeEligibilityPath = path.join(
  root,
  'src/app/core/services/compliance/age-eligibility.service.ts'
);
if (fs.existsSync(clientAgeEligibilityPath)) {
  const source = codeOnly(fs.readFileSync(clientAgeEligibilityPath, 'utf8'));

  for (const required of [
    'trustedSessionProjection',
    'response.data.ageEligibility',
    "state.status === 'SELF_DECLARED_ADULT'",
    "state.status === 'VERIFIED_ADULT'",
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `src/app/core/services/compliance/age-eligibility.service.ts (confirmação backend deve atravessar a janela realtime sem nova pergunta: ${required})`
      );
    }
  }
}

const currentUserStorePath = path.join(
  root,
  'src/app/core/services/autentication/auth/current-user-store.service.ts'
);
if (fs.existsSync(currentUserStorePath)) {
  const source = codeOnly(fs.readFileSync(currentUserStorePath, 'utf8'));

  if (!source.includes("'ageEligibility'")) {
    violations.push(
      'src/app/core/services/autentication/auth/current-user-store.service.ts (ageEligibility deve permanecer protegido contra patch genérico client-authoritative)'
    );
  }
}

const refreshAgeEligibilityPath = path.join(
  root,
  'functions/src/compliance/refresh-my-age-eligibility.handler.ts'
);
if (fs.existsSync(refreshAgeEligibilityPath)) {
  const source = codeOnly(fs.readFileSync(refreshAgeEligibilityPath, 'utf8'));

  for (const required of [
    'projectionFromCanonicalAgeDecision',
    'ageEligibility: projection',
    'currentDecision.status',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/refresh-my-age-eligibility.handler.ts (refresh canônico deve reparar projeção sem nova confirmação: ${required})`
      );
    }
  }
}

const trustedAgeDecisionFiles = Object.freeze([
  'functions/src/compliance/review-initial-age-verification.handler.ts',
  'functions/src/compliance/review-profile-age-reverification.handler.ts',
]);

for (const relativePath of trustedAgeDecisionFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = codeOnly(fs.readFileSync(absolutePath, 'utf8'));

  for (const required of [
    'normalizeAgeReviewEvidence',
    'evidenceReferenceHash',
    'writeCanonicalAgeEligibilityInTransaction',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `${relativePath} (decisão humana de maioridade deve exigir evidência confiável: ${required})`
      );
    }
  }

  if (/SELF_DECLARATION_REVIEW/.test(source)) {
    violations.push(
      `${relativePath} (autodeclaração não pode ser método de evidência para decisão etária)`
    );
  }
}

const initialAgeRequestPath = path.join(
  root,
  'functions/src/compliance/request-initial-age-verification-review.handler.ts'
);
if (fs.existsSync(initialAgeRequestPath)) {
  const source = codeOnly(fs.readFileSync(initialAgeRequestPath, 'utf8'));

  for (const required of [
    "status: 'REVIEW_REQUIRED'",
    "source: 'INITIAL_VERIFICATION'",
    "reason: 'age_verification_request'",
    'writeCanonicalAgeEligibilityInTransaction',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/request-initial-age-verification-review.handler.ts (solicitação inicial deve permanecer fail-closed em revisão: ${required})`
      );
    }
  }

  if (/VERIFIED_ADULT[\s\S]{0,240}request\.data/.test(source)) {
    violations.push(
      'functions/src/compliance/request-initial-age-verification-review.handler.ts (input do cliente não pode promover diretamente VERIFIED_ADULT)'
    );
  }
}


const minorSafetyReportPath = path.join(
  root,
  'functions/src/compliance/report-profile-minor-safety.handler.ts'
);
if (fs.existsSync(minorSafetyReportPath)) {
  const source = codeOnly(fs.readFileSync(minorSafetyReportPath, 'utf8'));

  for (const required of [
    'enforceAppCheck',
    'consumeBackendRateLimitQuota',
    'getModerationReporterAbuseRisk',
    'safeRecordModerationOpenSignal',
    'allowReversibleEnforcement: true',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/report-profile-minor-safety.handler.ts (denúncia de menoridade deve preservar proteção transversal: ${required})`
      );
    }
  }
}

const moderationPolicyPath = path.join(
  root,
  'functions/src/moderation/moderation-automation.policy.ts'
);
if (fs.existsSync(moderationPolicyPath)) {
  const source = codeOnly(fs.readFileSync(moderationPolicyPath, 'utf8'));

  for (const required of [
    'holdCriticalReports',
    'holdCriticalUniqueReporters',
    "'TEMPORARY_INTERACTION_HOLD'",
    "'critical_report_volume'",
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/moderation/moderation-automation.policy.ts (denúncia crítica sem equipe deve preservar resposta reversível: ${required})`
      );
    }
  }
}

const ageAppealPath = path.join(
  root,
  'functions/src/compliance/appeal-profile-age-reverification.handler.ts'
);
if (fs.existsSync(ageAppealPath)) {
  const source = codeOnly(fs.readFileSync(ageAppealPath, 'utf8'));

  for (const required of [
    'enforceAppCheck',
    'consumeBackendRateLimitQuota',
    "status: 'UNDER_REVIEW'",
    'interactionBlocked: true',
    'compliance_cases',
    'compliance_audit',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/appeal-profile-age-reverification.handler.ts (contestação deve ser auditável, rate-limited e fail-closed: ${required})`
      );
    }
  }
}

const ageReverificationReviewPath = path.join(
  root,
  'functions/src/compliance/review-profile-age-reverification.handler.ts'
);
if (fs.existsSync(ageReverificationReviewPath)) {
  const source = codeOnly(fs.readFileSync(ageReverificationReviewPath, 'utf8'));

  for (const required of [
    'activeAppealCaseId',
    'ageReverificationSuspensionCaseId',
    'enforcementEligible: false',
    'declaredUnderage && !activeAppealCaseId',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/review-profile-age-reverification.handler.ts (recurso etário deve permanecer reversível sem enforcement duplicado: ${required})`
      );
    }
  }
}

const adultConsentPath = path.join(
  root,
  'functions/src/compliance/adult-consent.handler.ts'
);
if (fs.existsSync(adultConsentPath)) {
  const source = codeOnly(fs.readFileSync(adultConsentPath, 'utf8'));

  for (const required of [
    'age_eligibility_records',
    'evaluateCanonicalAgeEligibility',
    'ageDecision.allowed',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/adult-consent.handler.ts (consentimento adulto deve permanecer posterior à prova etária: ${required})`
      );
    }
  }
}



const verifiedPublicProjectionFiles = Object.freeze([
  'functions/src/discovery/sync-public-profile-discovery.handler.ts',
  'functions/src/discovery/sync-public-preference-projection.handler.ts',
  'functions/src/discovery/user-intent-status.handler.ts',
]);

for (const relativePath of verifiedPublicProjectionFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push(
      `${relativePath} (projeção pública de maioridade verificada ausente)`
    );
    continue;
  }

  const source = codeOnly(fs.readFileSync(absolutePath, 'utf8'));

  if (!source.includes('isVerifiedAdultAgeDecision')) {
    violations.push(
      `${relativePath} (projeção pública adulta deve depender de isVerifiedAdultAgeDecision)`
    );
  }

  if (
    relativePath !== 'functions/src/discovery/user-intent-status.handler.ts'
    && source.includes('ageEligibilityVerifiedAdult: true')
  ) {
    violations.push(
      `${relativePath} (ageEligibilityVerifiedAdult não pode ser hardcoded a partir de acesso provisório)`
    );
  }
}

const mediaConsumptionVerifiedBoundaryFiles = Object.freeze([
  {
    path: 'functions/src/media/application/public-media-consumption-access.policy.ts',
    required: [
      'isVerifiedAdultAgeDecision',
      "'AGE_VERIFICATION_REQUIRED'",
    ],
  },
  {
    path: 'firestore-rules/_helpers.rules',
    required: [
      'canonicalAgeEligibilityIsVerifiedAdult',
      'currentUserHasVerifiedAdultAge',
      'canConsumeAdultPublicMedia',
    ],
  },
]);

for (const boundary of mediaConsumptionVerifiedBoundaryFiles) {
  const absolutePath = path.join(root, boundary.path);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`${boundary.path} (fronteira forte de consumo Media ausente)`);
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const required of boundary.required) {
    if (!source.includes(required)) {
      violations.push(
        `${boundary.path} (consumo público de Media deve preservar verificação forte: ${required})`
      );
    }
  }
}

const mediaAuthoringBoundaryFiles = Object.freeze([
  {
    path: 'functions/src/media/application/media-authoring-eligibility.service.ts',
    required: [
      'assertInteractionAccessData',
      'evaluateCanonicalAgeEligibility',
      'ageEligibility.allowed',
      "ageEligibility.status === 'VERIFIED_ADULT'",
    ],
  },
  {
    path: 'functions/src/media/application/reserve-photo-upload.handler.ts',
    required: ['assertMediaAuthoringEligibility'],
    forbidden: ['assertPublicMediaConsumptionAccess'],
  },
  {
    path: 'functions/src/media/application/register-private-photo-upload.handler.ts',
    required: ['assertMediaAuthoringEligibility'],
    forbidden: ['isVerifiedAdultAgeDecision'],
  },
  {
    path: 'functions/src/media/application/private-video-upload-eligibility.service.ts',
    required: ['assertMediaAuthoringEligibilityData'],
    forbidden: ['isVerifiedAdultAgeDecision'],
  },
  {
    path: 'functions/src/media/application/manage-photo-publication.handler.ts',
    required: [
      'assertMediaAuthoringEligibility',
      'ageEligibilityAdultAccessAllowed: true',
      'ageEligibilityAssurance',
    ],
    forbidden: ['isVerifiedAdultAgeDecision'],
  },
  {
    path: 'functions/src/media/application/manage-video-publication.handler.ts',
    required: [
      'assertMediaAuthoringEligibility',
      'ageEligibilityAdultAccessAllowed: true',
      'ageEligibilityAssurance',
    ],
    forbidden: ['isVerifiedAdultAgeDecision'],
  },
  {
    path: 'functions/src/media/application/public-media-owner-exposure.service.ts',
    required: ['ownerAgeDecision.allowed'],
    forbidden: ['isVerifiedAdultAgeDecision(ownerAgeDecision)'],
  },
  {
    path: 'firestore-rules/public_profiles_photos.rules',
    required: [
      'canConsumeAdultPublicMedia()',
      'canonicalAgeEligibilityAllowsAdultAccess(userId)',
      'ageEligibilityAdultAccessAllowed == true',
    ],
  },
  {
    path: 'firestore-rules/public_profiles_videos.rules',
    required: [
      'canConsumeAdultPublicMedia()',
      'canonicalAgeEligibilityAllowsAdultAccess(userId)',
      'ageEligibilityAdultAccessAllowed == true',
    ],
  },
]);

for (const boundary of mediaAuthoringBoundaryFiles) {
  const absolutePath = path.join(root, boundary.path);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`${boundary.path} (fronteira de autoria Media ausente)`);
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const required of boundary.required) {
    if (!source.includes(required)) {
      violations.push(
        `${boundary.path} (autoria Media deve depender da autoridade adulta da conta: ${required})`
      );
    }
  }

  for (const forbidden of boundary.forbidden ?? []) {
    if (source.includes(forbidden)) {
      violations.push(
        `${boundary.path} (autoria Media não pode reusar gate de consumo/verificação forte: ${forbidden})`
      );
    }
  }
}

const angularAdultSocialBoundaryFiles = Object.freeze([
  {
    path: 'src/app/core/services/autentication/auth/access-control.service.ts',
    required: [
      'canUseAdultSocial$',
      'this.ageEligibility.adultAccessAllowed$',
      'TERMS_ACCEPTANCE_VERSION',
      'ADULT_CONSENT_VERSION',
      'canRunPresence$',
    ],
  },
  {
    path: 'src/app/store/effects/effects.interactions/friends/network.effects.ts',
    required: [
      'this.access.canUseAdultSocial$',
      'canUseAdultSocial === true',
    ],
  },
  {
    path: 'src/app/core/services/interactions/friendship/repo/requests.repo.ts',
    required: [
      'this.inCtxSync(() =>',
      "'getPendingFriendRequests'",
    ],
  },
]);

for (const boundary of angularAdultSocialBoundaryFiles) {
  const absolutePath = path.join(root, boundary.path);
  if (!fs.existsSync(absolutePath)) {
    violations.push(
      `${boundary.path} (fronteira social adulta Angular ausente)`
    );
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const required of boundary.required) {
    if (!source.includes(required)) {
      violations.push(
        `${boundary.path} (fronteira social adulta deve preservar: ${required})`
      );
    }
  }
}

const rulesOptionalFieldHelperPath = path.join(
  root,
  'firestore-rules',
  '_helpers.rules'
);
if (fs.existsSync(rulesOptionalFieldHelperPath)) {
  const source = fs.readFileSync(rulesOptionalFieldHelperPath, 'utf8');
  for (const required of [
    'let value = mapFieldOrNull(request.resource.data, k);',
    'return value == null || value is string;',
    'return value == null || value is number;',
    'return value == null || isTs(value);',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `firestore-rules/_helpers.rules (helper opcional deve ser null-safe: ${required})`
      );
    }
  }
}

const ageVerificationUxFiles = Object.freeze([
  {
    path: 'src/app/compliance/age-verification-page/age-verification-page.component.ts',
    required: [
      'confirmAdult(): void',
      'acceptSelfDeclaration$()',
      'getCurrentOnce$()',
      'refreshTrustedSources$()',
      'adultAccessAllowed$',
      "?? '/dashboard/principal'",
      'goToNotifications(): void',
      'goToAccount(): void',
    ],
    forbidden: [
      'verifyNow(): void',
      'requestInitialReview$()',
      'refresh(): void',
    ],
  },
  {
    path: 'src/app/compliance/age-verification-page/age-verification-page.component.html',
    required: [
      'Confirmo que tenho 18 anos ou mais',
      'declara que tem 18 anos ou mais',
      'Perfis podem ser denunciados por possível menoridade',
      'Ver notificações',
      'Ir para minha conta',
    ],
    forbidden: [
      'Verificação em análise',
      'Já concluiu? Atualizar status',
      '(click)="refresh()"',
    ],
  },
]);
for (const boundary of ageVerificationUxFiles) {
  const absolutePath = path.join(root, boundary.path);
  if (!fs.existsSync(absolutePath)) {
    violations.push(
      `${boundary.path} (jornada guiada de maioridade ausente)`
    );
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const required of boundary.required) {
    if (!source.includes(required)) {
      violations.push(
        `${boundary.path} (UX de maioridade deve preservar: ${required})`
      );
    }
  }

  for (const forbidden of boundary.forbidden) {
    if (source.includes(forbidden)) {
      violations.push(
        `${boundary.path} (UX de maioridade não pode reintroduzir: ${forbidden})`
      );
    }
  }
}

const communityAgeBoundaryFiles = Object.freeze([
  'functions/src/community/community-social-access.service.ts',
  'functions/src/account_lifecycle/interaction-access.policy.ts',
]);

for (const relativePath of communityAgeBoundaryFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = codeOnly(fs.readFileSync(absolutePath, 'utf8'));
  if (
    !source.includes('age_eligibility_records') &&
    !source.includes('evaluateCanonicalAgeEligibility') &&
    !source.includes('assertInteractionAccessData')
  ) {
    violations.push(
      `${relativePath} (acesso social/Comunidades deve depender da autoridade etária canônica)`
    );
  }
}

const backendOnlyListRules = Object.freeze([
  {
    path: 'firestore-rules/public_profiles_next.rules',
    pattern: /allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'public_profiles deve permanecer sem enumeração client-side',
  },
  {
    path: 'firestore-rules/user_intent_statuses.rules',
    pattern: /allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'Status de Hoje deve permanecer sem enumeração client-side',
  },
  {
    path: 'firestore-rules/public_profiles_photos.rules',
    pattern: /match\s+\/public_profiles\/\{userId\}\/public_photos\/\{photoId\}\s*\{[\s\S]*?allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'galeria owner-scoped public_photos deve permanecer backend-only',
  },
  {
    path: 'firestore-rules/public_profiles_photos.rules',
    pattern: /match\s+\/\{path=\*\*\}\/public_photos\/\{[^}]+\}\s*\{[\s\S]*?allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'collection-group public_photos deve permanecer backend-only',
  },
  {
    path: 'firestore-rules/public_profiles_videos.rules',
    pattern: /match\s+\/public_profiles\/\{userId\}\/public_videos\/\{videoId\}\s*\{[\s\S]*?allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'galeria owner-scoped public_videos deve permanecer backend-only',
  },
  {
    path: 'firestore-rules/public_profiles_videos.rules',
    pattern: /match\s+\/\{path=\*\*\}\/public_videos\/\{[^}]+\}\s*\{[\s\S]*?allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'collection-group public_videos deve permanecer backend-only',
  },
  {
    path: 'firestore-rules/friendRequests.rules',
    pattern: /allow\s+list\s*:\s*if\s+false\s*;/,
    reason: 'friendRequests deve permanecer sem enumeração client-side',
  },
]);

for (const rule of backendOnlyListRules) {
  const absolutePath = path.join(root, rule.path);
  if (!fs.existsSync(absolutePath)) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  if (!rule.pattern.test(source)) {
    violations.push(`${rule.path} (${rule.reason})`);
  }
}

const temporalReadBoundaries = Object.freeze([
  {
    path: 'functions/src/discovery/get-public-profiles-page.handler.ts',
    required: [
      'ageEligibilityVerifiedAdult',
      'ageEligibilityValidUntil',
      'Date.now()',
    ],
  },
  {
    path: 'functions/src/discovery/get-user-intent-statuses.handler.ts',
    required: [
      'ageEligibilityVerifiedAdult',
      'ageEligibilityValidUntil',
      'Date.now()',
    ],
  },
  {
    path: 'functions/src/media/application/get-public-media-discovery.handler.ts',
    required: [
      'isCurrentPublicMediaProjectionExposure',
      'resolvePublicMediaOwnerExposure',
      'Date.now()',
    ],
  },
]);

for (const boundary of temporalReadBoundaries) {
  const absolutePath = path.join(root, boundary.path);
  if (!fs.existsSync(absolutePath)) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const required of boundary.required) {
    if (!source.includes(required)) {
      violations.push(
        `${boundary.path} (boundary público deve preservar: ${required})`
      );
    }
  }
}

const publicMediaExposurePolicyPath = path.join(
  root,
  'functions/src/media/application/public-media-exposure.policy.ts'
);
if (fs.existsSync(publicMediaExposurePolicyPath)) {
  const source = fs.readFileSync(publicMediaExposurePolicyPath, 'utf8');

  for (const required of [
    'publicAgeProjectionValidUntilMs',
    'evaluatePublicMediaOwnerExposure',
    'evaluatePublicMediaSignedOwnerExposure',
    'isCurrentPublicMediaProjectionExposure',
    'isCurrentPublicMediaAssetExposure',
    'BILATERAL_BLOCK',
    'APPROVED',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/media/application/public-media-exposure.policy.ts (policy canônica de exposure deve preservar: ${required})`
      );
    }
  }
}

const publicMediaOwnerExposureServicePath = path.join(
  root,
  'functions/src/media/application/public-media-owner-exposure.service.ts'
);
if (fs.existsSync(publicMediaOwnerExposureServicePath)) {
  const source = fs.readFileSync(publicMediaOwnerExposureServicePath, 'utf8');

  for (const required of [
    'public_profiles',
    'age_eligibility_records',
    'evaluateCanonicalAgeEligibility',
    'evaluatePublicMediaOwnerExposure',
    'evaluatePublicMediaSignedOwnerExposure',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/media/application/public-media-owner-exposure.service.ts (resolver canônico de owner exposure deve preservar: ${required})`
      );
    }
  }
}

const signedMediaAgeBoundaryFiles = Object.freeze([
  'functions/src/media/application/get-public-photo-access-urls.handler.ts',
  'functions/src/media/application/get-public-video-access-urls.handler.ts',
]);

for (const relativePath of signedMediaAgeBoundaryFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const required of [
    'resolvePublicMediaSignedUrlExpiresAt',
    'resolvePublicMediaSignedOwnerExposure',
    'ageEligibilityExpiresAtMs',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `${relativePath} (URL assinada deve respeitar ${required})`
      );
    }
  }
}

const mediaAgeExpiryPolicyPath = path.join(
  root,
  'functions/src/media/application/public-media-age-expiry.policy.ts'
);

if (fs.existsSync(mediaAgeExpiryPolicyPath)) {
  const source = fs.readFileSync(mediaAgeExpiryPolicyPath, 'utf8');
  if (
    !source.includes('technicalExpiresAtMs') ||
    !source.includes('viewerExpiresAtMs') ||
    !source.includes('ownerExpiresAtMs') ||
    !source.includes('mediaExpiresAtMs')
  ) {
    violations.push(
      'functions/src/media/application/public-media-age-expiry.policy.ts (TTL deve ser limitado por técnica + viewer + owner + mídia)'
    );
  }
}

const unique = [...new Set(violations)].sort();
if (unique.length > 0) {
  console.error('[age-authority] Fronteira etária canônica violada:');
  for (const violation of unique) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '[age-authority] Não derive maioridade de ageVerification, idade ou adultConsent. ' +
      'Use age_eligibility_records backend-only e a projeção sanitizada somente para UX.'
  );
  process.exit(1);
}

console.log(
  '[age-authority] OK: acesso adulto inicial pode usar autodeclaração registrada no backend; verificação forte continua distinta, backend-only e preparada para provider/KYC.'
);
