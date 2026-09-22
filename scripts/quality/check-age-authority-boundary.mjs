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
  'src/app/core/services/compliance/age-eligibility.service.ts',
  'src/app/core/guards/compliance/age-eligibility.guard.ts',
  'firestore-rules/age_eligibility_records.rules',
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
  '[age-authority] OK: ageEligibility permanece backend-only e ageVerification legado permanece fail-closed.'
);
