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
  'src/app/core/guards/compliance/current-terms.guard.ts',
  'src/app/core/services/autentication/auth/access-control.service.ts',
  'src/app/core/services/presence/presence-orchestrator.service.ts',
  'src/app/store/effects/effects.interactions/friends/network.effects.ts',
  'firestore-rules/age_eligibility_records.rules',
  'functions/src/discovery/get-public-profiles-page.handler.ts',
  'functions/src/discovery/get-user-intent-statuses.handler.ts',
  'functions/src/media/application/get-public-media-discovery.handler.ts',
  'src/app/core/services/discovery/public-profile-read-boundary.service.ts',
  'src/app/core/services/media/public-media-read-boundary.service.ts',
  'functions/src/friendship/application/get-pending-friend-requests.handler.ts',
  'functions/src/community/get-community-member-roster-page.handler.ts',
  'functions/src/community/get-profile-public-communities.handler.ts',
  'src/app/core/services/geolocation/nearby-profiles-query.gateway.ts',
  'src/app/core/services/batepapo/invite-service/invite-search.service.ts',
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

const legacyDerivedProjectionPaths = Object.freeze([
  'functions/src/discovery/sync-public-profile-discovery.handler.ts',
  'functions/src/discovery/backfill-public-profile-discovery.handler.ts',
  'functions/src/discovery/user-intent-status.handler.ts',
  'functions/src/community/community-social-access.service.ts',
]);

for (const relativePath of legacyDerivedProjectionPaths) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = codeOnly(fs.readFileSync(absolutePath, 'utf8'));

  for (const [pattern, reason] of [
    [/\[['"]idade['"]\]|\.idade\b/g, 'idade legada não pode alimentar autorização/projeção adulta'],
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

const helperPath = path.join(root, 'firestore-rules', '_helpers.rules');
if (fs.existsSync(helperPath)) {
  const source = fs.readFileSync(helperPath, 'utf8');
  for (const required of [
    'canonicalAgeEligibilityAllowsAdultAccess',
    'currentUserHasVerifiedAdultAge',
    'currentUserCanUseAdultSocialPlatform',
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `firestore-rules/_helpers.rules (helper canônico ausente: ${required})`
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
    'enforceAppCheck',
    'consumeBackendRateLimitQuota',
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
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `functions/src/compliance/report-profile-minor-safety.handler.ts (denúncia de menoridade deve preservar proteção transversal: ${required})`
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
  'functions/src/discovery/get-public-profiles-page.handler.ts',
  'functions/src/discovery/get-user-intent-statuses.handler.ts',
  'functions/src/media/application/get-public-media-discovery.handler.ts',
]);

for (const relativePath of temporalReadBoundaries) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  if (
    !source.includes('ageEligibilityVerifiedAdult') ||
    !source.includes('ageEligibilityValidUntil') ||
    !source.includes('Date.now()')
  ) {
    violations.push(
      `${relativePath} (boundary público deve validar projeção adulta e relógio do backend)`
    );
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
    'evaluateCanonicalAgeEligibility',
    'age_eligibility_records',
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


const runtimeAdultAccessPath = path.join(
  root,
  'src/app/core/services/autentication/auth/access-control.service.ts'
);
if (fs.existsSync(runtimeAdultAccessPath)) {
  const source = codeOnly(fs.readFileSync(runtimeAdultAccessPath, 'utf8'));

  for (const required of [
    'canRunAdultSessionRealtime
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
,
    'this.ageEligibility.verifiedAdult
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
,
    'isCurrentLegalAcceptanceSatisfied',
    'ADULT_CONSENT_VERSION',
    'readonly canRunPresence
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
,
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `src/app/core/services/autentication/auth/access-control.service.ts (runtime adulto deve usar gate canônico: ${required})`
      );
    }
  }
}

const friendsRuntimePath = path.join(
  root,
  'src/app/store/effects/effects.interactions/friends/network.effects.ts'
);
if (fs.existsSync(friendsRuntimePath)) {
  const source = codeOnly(fs.readFileSync(friendsRuntimePath, 'utf8'));

  if (!source.includes('this.access.canRunSensitiveRealtime
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
)) {
    violations.push(
      'src/app/store/effects/effects.interactions/friends/network.effects.ts (Friends deve pausar até o gate social adulto)'
    );
  }

  if (source.includes('this.access.canEnterCore
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
)) {
    violations.push(
      'src/app/store/effects/effects.interactions/friends/network.effects.ts (canEnterCore não pode iniciar listeners sociais adultos)'
    );
  }
}

const presenceRuntimePath = path.join(
  root,
  'src/app/core/services/presence/presence-orchestrator.service.ts'
);
if (fs.existsSync(presenceRuntimePath)) {
  const source = codeOnly(fs.readFileSync(presenceRuntimePath, 'utf8'));

  if (!source.includes('this.access.canRunPresence
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
)) {
    violations.push(
      'src/app/core/services/presence/presence-orchestrator.service.ts (Presence deve depender do gate adulto canônico)'
    );
  }
}

const pendingRequestsRepoPath = path.join(
  root,
  'src/app/core/services/interactions/friendship/repo/requests.repo.ts'
);
if (fs.existsSync(pendingRequestsRepoPath)) {
  const source = codeOnly(fs.readFileSync(pendingRequestsRepoPath, 'utf8'));

  if (!source.includes('this.inCtxSync(() => httpsCallable')) {
    violations.push(
      'src/app/core/services/interactions/friendship/repo/requests.repo.ts (httpsCallable deve nascer no injection context)'
    );
  }
}

if (fs.existsSync(helperPath)) {
  const source = codeOnly(fs.readFileSync(helperPath, 'utf8'));
  const nullSafeOptionalReads = (
    source.match(/mapFieldOrNull\(request\.resource\.data, k\)/g) ?? []
  ).length;

  if (nullSafeOptionalReads < 3) {
    violations.push(
      'firestore-rules/_helpers.rules (campos opcionais devem usar leitura dinâmica null-safe)'
    );
  }
}

const adultFlowRoutingPath = path.join(root, 'src/app/app-routing.module.ts');
if (fs.existsSync(adultFlowRoutingPath)) {
  const source = codeOnly(fs.readFileSync(adultFlowRoutingPath, 'utf8'));

  for (const required of [
    'currentTermsGuard',
    'ageEligibilityGuard',
    "path: 'adulto/verificar-idade'",
    "path: 'adulto/confirmar'",
  ]) {
    if (!source.includes(required)) {
      violations.push(
        `src/app/app-routing.module.ts (sequência de compliance incompleta: ${required})`
      );
    }
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
  '[age-authority] OK: maioridade permanece backend-only, decisões humanas exigem evidência e consentimento não substitui prova etária.'
);
