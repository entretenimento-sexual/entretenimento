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
// - Explore/Locais não resolvem os serviços privados usados por Minhas comunidades;
// - community_feed_realtime possui owner único de leitura;
// - CommunityFeed só abre esse listener através do coordenador de primeiro plano;
// - qualquer Comunidade fora do lease ativo permanece no modo agregado.
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
const COMMUNITY_FEED_REALTIME_COLLECTION = 'community_feed_realtime';
const COMMUNITY_FEED_REALTIME_OWNER = path.normalize(
  'src/app/community/data-access/community-feed.repository.ts'
);
const COMMUNITY_FEED_REALTIME_COORDINATOR = path.normalize(
  'src/app/community/data-access/community-realtime-attention-coordinator.service.ts'
);
const COMMUNITY_FEED_REALTIME_CONSUMER = path.normalize(
  'src/app/community/feed/community-feed.component.ts'
);
const COMMUNITY_FEED_COMMENT_REALTIME_CONSUMER = path.normalize(
  'src/app/community/feed-comments/community-feed-comments.component.ts'
);

const OFFICIAL_CREATE_HANDLER = path.normalize(
  'functions/src/community/create-official-community.handler.ts'
);
const OFFICIAL_CREATE_MODEL = path.normalize(
  'functions/src/community/create-official-community.model.ts'
);
const OFFICIAL_AUTHORITY_CONTEXT = path.normalize(
  'functions/src/community/community-official-authority-context.service.ts'
);
const COMMUNITY_CLAIM_HANDLER = path.normalize(
  'functions/src/community/community-official-claim.handler.ts'
);
const COMMUNITY_CAPACITY_SERVICE = path.normalize(
  'functions/src/community/community-capacity.service.ts'
);
const PERSONAL_CREATE_HANDLER = path.normalize(
  'functions/src/community/create-community.handler.ts'
);
const EVENT_AUTHORITY_SERVICE = path.normalize(
  'functions/src/authority/event-authority-record.service.ts'
);
const EVENT_AUTHORITY_HANDLER = path.normalize(
  'functions/src/authority/event-authority.handler.ts'
);
const FUNCTIONS_ROOT_INDEX = path.normalize('functions/src/index.ts');

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

    const realtimeCollectionIndex = source.indexOf(
      COMMUNITY_FEED_REALTIME_COLLECTION
    );

    if (
      realtimeCollectionIndex >= 0
      && relativePath !== COMMUNITY_FEED_REALTIME_OWNER
    ) {
      const position = lineAndColumn(source, realtimeCollectionIndex);
      architectureViolations.push(
        `${relativePath}:${position.line}:${position.column} `
          + `(${COMMUNITY_FEED_REALTIME_COLLECTION} fora do owner canônico)`
      );
    }

    const detailedWatcherIndex = source.indexOf('watchLatestChanges$(');
    if (
      detailedWatcherIndex >= 0
      && relativePath !== COMMUNITY_FEED_REALTIME_OWNER
      && relativePath !== COMMUNITY_FEED_REALTIME_CONSUMER
    ) {
      const position = lineAndColumn(source, detailedWatcherIndex);
      architectureViolations.push(
        `${relativePath}:${position.line}:${position.column} `
          + '(watchLatestChanges$ fora do consumidor/coordenador canônico)'
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

  const realtimeOwnerSource = readRequiredSource(
    COMMUNITY_FEED_REALTIME_OWNER,
    architectureViolations
  );
  const realtimeCoordinatorSource = readRequiredSource(
    COMMUNITY_FEED_REALTIME_COORDINATOR,
    architectureViolations
  );
  const realtimeConsumerSource = readRequiredSource(
    COMMUNITY_FEED_REALTIME_CONSUMER,
    architectureViolations
  );
  const realtimeCommentConsumerSource = readRequiredSource(
    COMMUNITY_FEED_COMMENT_REALTIME_CONSUMER,
    architectureViolations
  );

  if (
    realtimeOwnerSource
    && !realtimeOwnerSource.includes(
      'community_feed_realtime/${safeCommunityId}/items'
    )
  ) {
    architectureViolations.push(
      `${COMMUNITY_FEED_REALTIME_OWNER} (owner não aponta para a projeção realtime mínima)`
    );
  }

  if (realtimeCoordinatorSource) {
    for (const required of [
      'claimMode$(',
      "'detailed'",
      "'aggregate'",
      "'visibilitychange'",
      'activeLeaseSubject',
    ]) {
      if (!realtimeCoordinatorSource.includes(required)) {
        architectureViolations.push(
          `${COMMUNITY_FEED_REALTIME_COORDINATOR} (contrato de primeiro plano ausente: ${required})`
        );
      }
    }
  }

  if (realtimeConsumerSource) {
    for (const required of [
      'CommunityRealtimeAttentionCoordinatorService',
      '.claimMode$(communityId)',
      "attentionMode !== 'detailed'",
      '.watchLatestChanges$(communityId, 20)',
    ]) {
      if (!realtimeConsumerSource.includes(required)) {
        architectureViolations.push(
          `${COMMUNITY_FEED_REALTIME_CONSUMER} (realtime detalhado sem gate canônico: ${required})`
        );
      }
    }
  }

  if (realtimeCommentConsumerSource) {
    for (const required of [
      'CommunityRealtimeAttentionCoordinatorService',
      '.modeForCommunity$(communityId)',
      "attentionMode !== 'detailed'",
      '.watchCommentCount$(communityId, postId)',
    ]) {
      if (!realtimeCommentConsumerSource.includes(required)) {
        architectureViolations.push(
          `${COMMUNITY_FEED_COMMENT_REALTIME_CONSUMER} (realtime de comentário sem gate do primeiro plano: ${required})`
        );
      }
    }
  }

  const discoverySource = readRequiredSource(
    COMMUNITY_DISCOVERY_COMPONENT,
    architectureViolations
  );

  if (!discoverySource) return;

  const privateServices = [
    {
      serviceName: 'CommunityNotificationUnreadSummaryService',
      expectedLazyGetCount: 1,
    },
    {
      serviceName: 'CommunityNotificationPreferenceService',
      expectedLazyGetCount: 2,
      guardedCommandPattern: /toggleCommunityNotifications\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]{0,350}?this\.discoveryMode\s*!==\s*['"]mine['"][\s\S]{0,700}?this\.injector\.get\s*\(\s*CommunityNotificationPreferenceService\s*\)/m,
    },
  ];

  for (const {
    serviceName,
    expectedLazyGetCount,
    guardedCommandPattern,
  } of privateServices) {
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
    if (lazyGetCount !== expectedLazyGetCount) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} deve possuir ${expectedLazyGetCount} resolução(ões) lazy canônica(s); encontrado ${lazyGetCount})`
      );
    }

    if (!mineGuardedLazyPattern.test(discoverySource)) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} deve alimentar o read model via defer + Injector.get somente em mine)`
      );
    }

    if (
      guardedCommandPattern
      && !guardedCommandPattern.test(discoverySource)
    ) {
      architectureViolations.push(
        `${COMMUNITY_DISCOVERY_COMPONENT} `
          + `(${serviceName} deve manter a mutação de preferência protegida por discoveryMode mine)`
      );
    }
  }
}


function validateOfficialCreationBoundary(architectureViolations) {
  const handlerSource = readRequiredSource(
    OFFICIAL_CREATE_HANDLER,
    architectureViolations
  );
  const modelSource = readRequiredSource(
    OFFICIAL_CREATE_MODEL,
    architectureViolations
  );
  const contextSource = readRequiredSource(
    OFFICIAL_AUTHORITY_CONTEXT,
    architectureViolations
  );
  const claimSource = readRequiredSource(
    COMMUNITY_CLAIM_HANDLER,
    architectureViolations
  );
  const capacitySource = readRequiredSource(
    COMMUNITY_CAPACITY_SERVICE,
    architectureViolations
  );
  const personalCreateSource = readRequiredSource(
    PERSONAL_CREATE_HANDLER,
    architectureViolations
  );

  if (handlerSource) {
    for (const required of [
      'resolveCommunityOfficialAuthorityContext',
      'OFFICIAL_COMMUNITY_MEMBER_LIMIT',
      "sponsorType: 'official'",
      "role: 'owner'",
      "action: 'official_community_create'",
    ]) {
      if (!handlerSource.includes(required)) {
        architectureViolations.push(
          `${OFFICIAL_CREATE_HANDLER} (contrato oficial ausente: ${required})`
        );
      }
    }

    for (const forbidden of [
      'evaluatePlatformSubscriptionEntitlement',
      'platform_subscription_',
      'resolveCommunityCapacitySponsorRole',
      'minimumPersonalCommunityCreationRole',
    ]) {
      if (handlerSource.includes(forbidden)) {
        architectureViolations.push(
          `${OFFICIAL_CREATE_HANDLER} (criação oficial não pode depender de assinatura pessoal: ${forbidden})`
        );
      }
    }
  }

  if (modelSource) {
    for (const forbiddenField of [
      'authorityRole',
      'sponsorOrganizationId',
      'ownerUid',
      'memberLimit',
    ]) {
      const declarationPattern = new RegExp(
        String.raw`(?:interface\s+CreateOfficialCommunityRequest[\s\S]{0,1200}?\b${forbiddenField}\b|raw\?\.${forbiddenField}|source\.${forbiddenField})`,
        'm'
      );
      if (declarationPattern.test(modelSource)) {
        architectureViolations.push(
          `${OFFICIAL_CREATE_MODEL} (payload oficial não pode aceitar ${forbiddenField})`
        );
      }
    }
  }

  if (
    contextSource
    && !contextSource.includes('resolveCommunityOfficialClaimSubmission')
  ) {
    architectureViolations.push(
      `${OFFICIAL_AUTHORITY_CONTEXT} (deve reutilizar a policy canônica dos claims)`
    );
  }

  if (
    claimSource
    && !claimSource.includes('resolveCommunityOfficialAuthorityContext')
  ) {
    architectureViolations.push(
      `${COMMUNITY_CLAIM_HANDLER} (claim e criação devem compartilhar o mesmo resolver de autoridade)`
    );
  }

  if (
    capacitySource
    && (
      !capacitySource.includes("capacity['sponsorType']")
      || !capacitySource.includes("sponsorRole: 'official'")
    )
  ) {
    architectureViolations.push(
      `${COMMUNITY_CAPACITY_SERVICE} (capacidade oficial deve ser separada do entitlement pessoal)`
    );
  }

  if (
    personalCreateSource
    && !personalCreateSource.includes("sponsorType: 'personal'")
  ) {
    architectureViolations.push(
      `${PERSONAL_CREATE_HANDLER} (criação pessoal deve marcar sponsorType personal)`
    );
  }
}

function validateEventAuthorityLifecycleBoundary(architectureViolations) {
  const serviceSource = readRequiredSource(
    EVENT_AUTHORITY_SERVICE,
    architectureViolations
  );
  const handlerSource = readRequiredSource(
    EVENT_AUTHORITY_HANDLER,
    architectureViolations
  );
  const rootIndexSource = readRequiredSource(
    FUNCTIONS_ROOT_INDEX,
    architectureViolations
  );

  if (serviceSource) {
    for (const required of [
      "EVENT_AUTHORITY_RECORDS_COLLECTION = 'event_authority_records'",
      'issueEventAuthorityRecord',
      'revokeEventAuthorityRecord',
      'transaction.set(recordRef',
      'transaction.update(recordRef',
      'EVENT_AUTHORITY_AUDIT_COLLECTION',
      'EVENT_AUTHORITY_OPERATIONS_COLLECTION',
    ]) {
      if (!serviceSource.includes(required)) {
        architectureViolations.push(
          `${EVENT_AUTHORITY_SERVICE} (lifecycle canônico incompleto: ${required})`
        );
      }
    }
  }

  if (handlerSource) {
    for (const required of [
      'issueEventAuthority',
      'revokeEventAuthority',
      'issueEventAuthorityRecord',
      'revokeEventAuthorityRecord',
      'assertRecentAuthentication',
      'assertCallableAppCheck',
    ]) {
      if (!handlerSource.includes(required)) {
        architectureViolations.push(
          `${EVENT_AUTHORITY_HANDLER} (entrypoint de lifecycle incompleto: ${required})`
        );
      }
    }

    for (const forbidden of [
      'subscription',
      'CommunityMembership',
      'viewerRole',
      'communityRole',
    ]) {
      if (handlerSource.includes(forbidden)) {
        architectureViolations.push(
          `${EVENT_AUTHORITY_HANDLER} (autoridade de Evento não pode depender de ${forbidden})`
        );
      }
    }
  }

  if (
    rootIndexSource
    && (
      !rootIndexSource.includes('issueEventAuthority')
      || !rootIndexSource.includes('revokeEventAuthority')
    )
  ) {
    architectureViolations.push(
      `${FUNCTIONS_ROOT_INDEX} (callables do lifecycle de Evento não exportadas)`
    );
  }

  const allowedEventAuthorityReaders = new Set([
    EVENT_AUTHORITY_SERVICE,
    path.normalize('functions/src/authority/event-authority.policy.ts'),
    OFFICIAL_AUTHORITY_CONTEXT,
    path.normalize(
      'functions/src/community/community-official-claim-evidence.service.ts'
    ),
    path.normalize(
      'functions/src/community/get-community-official-claim-capability.handler.ts'
    ),
  ]);

  const functionsRoot = path.join(root, 'functions', 'src');
  for (const absolutePath of walkTypeScriptFiles(functionsRoot)) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const relativePath = normalizeRelativePath(absolutePath);

    if (
      source.includes('EVENT_AUTHORITY_RECORDS_COLLECTION')
      && relativePath !== EVENT_AUTHORITY_SERVICE
    ) {
      architectureViolations.push(
        `${relativePath} (somente EventAuthorityRecordService pode importar/usar o identificador de escrita do ledger)`
      );
    }

    if (
      source.includes('event_authority_records')
      && !allowedEventAuthorityReaders.has(relativePath)
    ) {
      architectureViolations.push(
        `${relativePath} (acesso ao ledger de Evento fora dos readers/writer canônicos)`
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
validateOfficialCreationBoundary(architectureViolations);
validateEventAuthorityLifecycleBoundary(architectureViolations);

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
  '[community-authority] OK: notificações preservam owner único; criação oficial separa autoridade/assinatura/role; Evento possui lifecycle writer único auditável.'
);
