// scripts/quality/check-community-authority-boundary.mjs
// -----------------------------------------------------------------------------
// COMMUNITY AUTHORITY BOUNDARY CHECK
// -----------------------------------------------------------------------------
// Campos de projeção/cache/UI de Comunidades nunca podem ser aceitos como
// autoridade a partir do payload de uma callable. Identidade do ator deve vir de
// request.auth; membership/role/capabilities devem ser relidos do backend; counts
// e scores são projeções materializadas/calculadas pelo backend.
//
// A fronteira Comunidades × Salas também é validada antes deste checker. Assim o
// mesmo Quality Gate impede tanto pseudoautoridade em Comunidades quanto regressão
// do domínio legado de Salas.
// -----------------------------------------------------------------------------

import './check-room-deprecation-boundary.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const communityBackendRoot = path.join(root, 'functions', 'src', 'community');

const FORBIDDEN_CLIENT_AUTHORITY_FIELDS = Object.freeze([
  'actorUid',
  'viewerUid',
  'viewerMode',
  'viewerRole',
  'viewerMembershipStatus',
  'canInteract',
  'canManageMemberships',
  'canInviteCommunityMembers',
  'canManageCommunitySettings',
  'canLeaveMembership',
  'metrics',
  'memberCount',
  'postCount',
  'mediaCount',
  'rankScore',
  'ranking',
  'discoveryScore',
  'qualityScore',
  'activityScore',
  'freshnessScore',
  'safetyScore',
  'scoreVersion',
  'scoreUpdatedAt',
  'activeCommunityIds',
  'officialAssociation',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FORBIDDEN_FIELD_PATTERN = FORBIDDEN_CLIENT_AUTHORITY_FIELDS
  .map(escapeRegExp)
  .join('|');

function walkTypeScriptFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(absolutePath));
      continue;
    }

    if (
      entry.isFile()
      && entry.name.endsWith('.ts')
      && !entry.name.endsWith('.spec.ts')
      && !entry.name.endsWith('.test.ts')
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

function normalizeRelativePath(absolutePath) {
  return path.normalize(path.relative(root, absolutePath));
}

function lineAndColumn(source, index) {
  const before = source.slice(0, index);
  const lines = before.split('\n');

  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function addViolation(violations, source, absolutePath, index, field) {
  const position = lineAndColumn(source, index);
  violations.push(
    `${normalizeRelativePath(absolutePath)}:${position.line}:${position.column} (${field})`
  );
}

function collectCallableRequestIdentifiers(source) {
  const identifiersWithData = new Set();
  const dataAccessPattern = /\b([A-Za-z_$][\w$]*)\.data\b/gm;

  for (const match of source.matchAll(dataAccessPattern)) {
    if (match[1]) identifiersWithData.add(match[1]);
  }

  return [...identifiersWithData].filter((identifier) => {
    const escaped = escapeRegExp(identifier);
    const callableContextPattern = new RegExp(
      String.raw`\b${escaped}\s*(?:\?\.|\.)\s*(?:auth|app)\b`,
      'm'
    );
    return callableContextPattern.test(source);
  });
}

function collectDataAliases(source, requestIdentifiers) {
  const aliases = new Set();

  for (const requestIdentifier of requestIdentifiers) {
    const escapedRequest = escapeRegExp(requestIdentifier);
    const aliasPattern = new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${escapedRequest}\.data\b`,
      'gm'
    );

    for (const match of source.matchAll(aliasPattern)) {
      if (match[1]) aliases.add(match[1]);
    }
  }

  return aliases;
}

function findForbiddenPropertyAccesses(source, rootExpressionPattern) {
  const findings = [];
  const dotPattern = new RegExp(
    String.raw`\b${rootExpressionPattern}\s*(?:\?\.|\.)\s*(${FORBIDDEN_FIELD_PATTERN})\b`,
    'gm'
  );
  const bracketPattern = new RegExp(
    String.raw`\b${rootExpressionPattern}\s*(?:\?\.)?\s*\[\s*['"](${FORBIDDEN_FIELD_PATTERN})['"]\s*\]`,
    'gm'
  );

  for (const pattern of [dotPattern, bracketPattern]) {
    for (const match of source.matchAll(pattern)) {
      findings.push({
        index: match.index ?? 0,
        field: match[1] ?? 'unknown',
      });
    }
  }

  return findings;
}

function findForbiddenDestructuring(source, initializerPattern) {
  const findings = [];
  const destructuringPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*${initializerPattern}\b`,
    'gms'
  );

  for (const match of source.matchAll(destructuringPattern)) {
    const binding = match[1] ?? '';
    const matchIndex = match.index ?? 0;

    for (const field of FORBIDDEN_CLIENT_AUTHORITY_FIELDS) {
      const fieldPattern = new RegExp(
        String.raw`(?:^|,)\s*${escapeRegExp(field)}\s*(?::|,|$)`,
        'm'
      );

      if (fieldPattern.test(binding)) {
        findings.push({ index: matchIndex, field });
      }
    }
  }

  return findings;
}

if (!fs.existsSync(communityBackendRoot)) {
  console.error(
    `[community-authority] Diretório não encontrado: ${communityBackendRoot}`
  );
  process.exit(1);
}

const violations = [];

for (const absolutePath of walkTypeScriptFiles(communityBackendRoot)) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  const requestIdentifiers = collectCallableRequestIdentifiers(source);

  for (const requestIdentifier of requestIdentifiers) {
    const requestDataPattern = `${escapeRegExp(requestIdentifier)}\\.data`;

    for (const finding of findForbiddenPropertyAccesses(source, requestDataPattern)) {
      addViolation(violations, source, absolutePath, finding.index, finding.field);
    }

    for (const finding of findForbiddenDestructuring(source, requestDataPattern)) {
      addViolation(violations, source, absolutePath, finding.index, finding.field);
    }
  }

  for (const alias of collectDataAliases(source, requestIdentifiers)) {
    const escapedAlias = escapeRegExp(alias);

    for (const finding of findForbiddenPropertyAccesses(source, escapedAlias)) {
      addViolation(violations, source, absolutePath, finding.index, finding.field);
    }

    for (const finding of findForbiddenDestructuring(source, escapedAlias)) {
      addViolation(violations, source, absolutePath, finding.index, finding.field);
    }
  }
}

const uniqueViolations = [...new Set(violations)].sort();

if (uniqueViolations.length > 0) {
  console.error(
    '[community-authority] Campo derivado/projetado lido do payload da callable:'
  );
  for (const violation of uniqueViolations) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '[community-authority] Derive ator de request.auth; releia membership/role/capabilities '
      + 'do backend; mantenha counts, ranking, índices e associação oficial como projeções '
      + 'backend-owned. O payload do navegador nunca concede autoridade.'
  );
  process.exit(1);
}

console.log(
  '[community-authority] OK: payloads de Comunidades não são usados como autoridade derivada.'
);
