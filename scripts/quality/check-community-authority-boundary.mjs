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
//
// O checker também protege a fronteira de custo das notificações de Comunidades:
// - community_notification_summaries possui um único owner de leitura no cliente;
// - o owner mantém um único listener agregado por usuário;
// - Explore/Locais não resolvem os serviços privados usados por Minhas comunidades.
// -----------------------------------------------------------------------------

import './check-room-deprecation-boundary.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const communityBackendRoot = path.join(root, 'functions', 'src', 'community');
const angularAppRoot = path.join(root, 'src', 'app');

const COMMUNITY_NOTIFICATION_SUMMARY_COLLECTION =
  'community_notification_summaries';
const COMMUNITY_NOTIFICATION_SUMMARY_OWNER = path.normalize(
  'src/app/core/services/notifications/community-notification-unread-summary.service.ts'
);
const COMMUNITY_DISCOVERY_COMPONENT = path.normalize(
  'src/app/community/discovery/community-discovery-page.component.ts'
);

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

function readRequiredSource(relativePath, architectureViolations) {
  const absolutePath = path.join(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    architectureViolations.push(`${relativePath} (arquivo obrigatório ausente)`);
    return '';
  }

  return fs.readFileSync(absolutePath, 'utf8');
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function validateCommunityNotificationClientBoundary(architectureViolations) {
  if (!fs.existsSync(angularAppRoot)) {
    architectureViolations.push(
      `${normalizeRelativePath(angularAppRoot)} (diretório Angular ausente)`
    );
    return;
  }

  for (const absolutePath of walkTypeScriptFiles(angularAppRoot)) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const relativePath = normalizeRelativePath(absolutePath);
    const collectionIndex = source.indexOf(
      COMMUNITY_NOTIFICATION_SUMMARY_COLLECTION
    );

    if (
      collectionIndex >= 0
      && relativePath !== COMMUNITY_NOTIFICATION_SUMMARY_OWNER
    ) {
      const position = lineAndColumn(source, collectionIndex);
      architectureViolations.push(
        `${relativePath}:${position.line}:${position.column} `
          + `(${COMMUNITY_NOTIFICATION_SUMMARY_COLLECTION} fora do owner canônico)`
      );
    }
  }

  const ownerSource = readRequiredSource(
    COMMUNITY_NOTIFICATION_SUMMARY_OWNER,
    architectureViolations
  );

  if (ownerSource) {
    const collectionOwnerPattern = /collection\(\s*this\.firestore\s*,\s*['"]community_notification_summaries['"]\s*,\s*uid\s*,\s*['"]items['"]\s*\)/m;
    const collectionDataCount = countMatches(ownerSource, /\bcollectionData\s*\(/gm);
    const summaryMapDerivesFromAggregate = /currentUserSummaryMap\$[\s\S]{0,220}=\s*this\.currentUserSummaries\$\.pipe\s*\(/m.test(
      ownerSource
    );
    const unreadCountDerivesFromAggregate = /currentUserUnreadCount\$[\s\S]{0,220}=\s*this\.currentUserSummaries\$\.pipe\s*\(/m.test(
      ownerSource
    );

    if (!collectionOwnerPattern.test(ownerSource)) {
      architectureViolations.push(
        `${COMMUNITY_NOTIFICATION_SUMMARY_OWNER} `
          + '(listener agregado não aponta para community_notification_summaries/{uid}/items)'
      );
    }

    if (collectionDataCount !== 1) {
      architectureViolations.push(
        `${COMMUNITY_NOTIFICATION_SUMMARY_OWNER} `
          + `(esperado 1 collectionData agregado; encontrado ${collectionDataCount})`
      );
    }

    if (!summaryMapDerivesFromAggregate) {
      architectureViolations.push(
        `${COMMUNITY_NOTIFICATION_SUMMARY_OWNER} `
          + '(currentUserSummaryMap$ deve derivar de currentUserSummaries$)'
      );
    }

    if (!unreadCountDerivesFromAggregate) {
      architectureViolations.push(
        `${COMMUNITY_NOTIFICATION_SUMMARY_OWNER} `
          + '(currentUserUnreadCount$ deve derivar de currentUserSummaries$)'
      );
    }
  }

  const discoverySource = readRequiredSource(
    COMMUNITY_DISCOVERY_COMPONENT,
    architectureViolations
  );

  if (!discoverySource) return;

  const privateServices = [
    'CommunityNotificationUnreadSummaryService',
    'CommunityNotificationPreferenceService',
  ];

  for (const serviceName of privateServices) {
    const eagerInjectPattern = new RegExp(
      String.raw`\binject\s*\(\s*${serviceName}\s*\)`,
      'm'
    );
    const constructorInjectionPattern = new RegExp(
      String.raw`\bconstructor\s*\([^)]*\b(?:private|protected|public)?\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\s*:\s*${serviceName}\b`,
      'ms'
    );
    const lazyGetPattern = new RegExp(
      String.raw`\bthis\.injector\.get\s*\(\s*${serviceName}\s*\)`,
      'gm'
    );
    const mineGuardedLazyPattern = new RegExp(
      String.raw`this\.discoveryMode\s*===\s*['"]mine['"][\s\S]{0,500}?defer\s*\(\s*\(\)\s*=>[\s\S]{0,300}?this\.injector\.get\s*\(\s*${serviceName}\s*\)`,
      'm'
    );

    if (eagerInjectPattern.test(discoverySource)) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} não pode usar inject() eager em Explore/Locais)`
      );
    }

    if (constructorInjectionPattern.test(discoverySource)) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} não pode ser dependência de constructor eager)`
      );
    }

    const lazyGetCount = countMatches(discoverySource, lazyGetPattern);
    if (lazyGetCount !== 1) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} deve possuir exatamente 1 resolução lazy; encontrado ${lazyGetCount})`
      );
    }

    if (!mineGuardedLazyPattern.test(discoverySource)) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} deve ser resolvido via defer + Injector.get somente em mine)`
      );
    }
  }
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

const architectureViolations = [];
validateCommunityNotificationClientBoundary(architectureViolations);

const uniqueArchitectureViolations = [...new Set(architectureViolations)].sort();

if (uniqueArchitectureViolations.length > 0) {
  console.error(
    '[community-authority] Fronteira de custo/autoridade das notificações de Comunidades violada:'
  );
  for (const violation of uniqueArchitectureViolations) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '[community-authority] Mantenha community_notification_summaries com owner único no '
      + 'CommunityNotificationUnreadSummaryService, um listener agregado por usuário e '
      + 'resolução lazy dos serviços privados somente em Minhas comunidades.'
  );
  process.exit(1);
}

console.log(
  '[community-authority] OK: payloads de Comunidades não são usados como autoridade derivada.'
);
console.log(
  '[community-authority] OK: notificações de Comunidades preservam owner único, listener agregado e lazy injection em mine.'
);
