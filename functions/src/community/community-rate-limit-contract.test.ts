// functions/src/community/community-rate-limit-contract.test.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

import {
  type CommunityRateLimitAction,
  getCommunityRateLimitPolicy,
} from './community-rate-limit.policy';

const communitySourceDirectory = path.resolve(
  __dirname,
  '../../src/community'
);
const repositoryRoot = path.resolve(__dirname, '../../..');
const frontendRateLimitMessagesPath = path.join(
  repositoryRoot,
  'src/app/community/presentation/community-rate-limit.messages.ts'
);

const READ_ONLY_CALLABLES = new Set([
  'getCommunityCreationCapability',
  'getCommunityTagCatalog',
  'getCommunityDiscoveryPage',
  'getProfileOfficialCommunities',
  'getOfficialCommunitiesForTarget',
  'getMyCommunityOfficialClaim',
  'getCommunityFeedPage',
  'getCommunityFeedItems',
  'getCommunityHighlight',
  'getCommunityFeedCommentsPage',
  'getCommunityFeedCommentRepliesPage',
  'getCommunityTopicsPage',
  'getCommunityTopicDetail',
  'getCommunityTopicRepliesPage',
  'getCommunityInvites',
  'findCommunityInviteCandidate',
  'getCommunitySentInvites',
  'getMyCommunitiesPage',
  'getCommunityMembershipContext',
  'getCommunityMembersForManagement',
  'getCommunityMembershipRequests',
  'getCommunityOwnershipCandidates',
  'getCommunityPreview',
  'inspectCommunityPurgeReadiness',
  'inspectCommunityRankingReadiness',
]);

const EXPECTED_CANONICAL_ACTION_BY_CALLABLE: Readonly<Record<
  string,
  CommunityRateLimitAction
>> = Object.freeze({
  createCommunity: 'community_create',
  createVenueCommunity: 'official_space_create',
  submitCommunityOfficialClaim: 'official_space_create',
  createCommunityFeedPost: 'feed_post',
  createCommunityFeedComment: 'feed_conversation',
  createCommunityFeedCommentReply: 'feed_conversation',
  createCommunityTopic: 'topic_conversation',
  createCommunityTopicReply: 'topic_conversation',
  toggleCommunityFeedReaction: 'feed_reaction',
  reportCommunityFeedPost: 'feed_report_post',
  reportCommunityFeedComment: 'feed_report_comment',
  reportCommunityFeedCommentReply: 'feed_report_reply',
  sendCommunityInvite: 'invite_send',
  requestCommunityMembership: 'membership_request',
  reviewCommunityMembership: 'membership_review',
  manageCommunityMember: 'member_management',
  manageCommunityHighlight: 'highlight_management',
  updateCommunitySettings: 'settings_update',
  transferCommunityOwnership: 'ownership_mutation',
  archiveCommunity: 'ownership_mutation',
  moderateCommunityFeedPost: 'content_moderation',
  moderateCommunityFeedComment: 'content_moderation',
  moderateCommunityFeedCommentReply: 'content_moderation',
  moderateCommunityTopic: 'content_moderation',
  reviewCommunityFeedPostReport: 'content_moderation',
  reviewCommunityFeedCommentReport: 'content_moderation',
  reviewCommunityFeedCommentReplyReport: 'content_moderation',
  reviewCommunityOfficialClaim: 'content_moderation',
  getCommunityOfficialClaimReviewQueue: 'content_moderation',
  configureCommunityRankingMode: 'operations_ranking',
});

// Exceções temporárias são deliberadamente explícitas. Uma nova callable de
// escrita não entra aqui automaticamente: ela deve adotar o adapter canônico ou
// ser classificada conscientemente, com justificativa e prioridade de remoção.
const DEFERRED_MUTATION_RATE_LIMIT_EXCEPTIONS = new Map<string, string>([
  [
    'leaveCommunityMembership',
    'P2: autosserviço de saída possui baixo potencial de amplificação.',
  ],
  [
    'acceptCommunityInvite',
    'P2: resposta ao próprio convite será agrupada no orçamento de convites.',
  ],
  [
    'declineCommunityInvite',
    'P2: resposta ao próprio convite será agrupada no orçamento de convites.',
  ],
  [
    'revokeCommunityInvite',
    'P2: revogação idempotente será agrupada no orçamento de convites.',
  ],
]);

const NON_CENTRAL_RATE_LIMIT_CALLABLES = new Map<string, string>([
  [
    'recordCommunityDiscoveryExposure',
    'consumeExposureQuota',
  ],
]);

const DIRECT_BACKEND_RATE_LIMIT_ALLOWED_FILES = new Set([
  'community-rate-limit.service.ts',
  'record-community-discovery-exposure.handler.ts',
]);

interface CommunityCallableRateLimitContract {
  readonly name: string;
  readonly fileName: string;
  readonly canonicalActions: readonly string[];
  readonly hasExpectedNonCentralWrapper: boolean;
}

function listProductionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listProductionTypeScriptFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    return [entryPath];
  });
}

function parseTypeScriptFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function callExpressionName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function isOnCallInitializer(
  initializer: ts.Expression | undefined
): initializer is ts.CallExpression {
  return Boolean(
    initializer
    && ts.isCallExpression(initializer)
    && callExpressionName(initializer.expression) === 'onCall'
  );
}

function containsCallNamed(node: ts.Node, callName: string): boolean {
  let found = false;

  const visit = (current: ts.Node): void => {
    if (found) return;

    if (
      ts.isCallExpression(current)
      && callExpressionName(current.expression) === callName
    ) {
      found = true;
      return;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
}

function collectCanonicalRateLimitActions(node: ts.Node): readonly string[] {
  const actions: string[] = [];

  const visit = (current: ts.Node): void => {
    if (
      ts.isCallExpression(current)
      && callExpressionName(current.expression) === 'consumeCommunityRateLimit'
    ) {
      const input = current.arguments[0];
      if (input && ts.isObjectLiteralExpression(input)) {
        for (const property of input.properties) {
          if (
            !ts.isPropertyAssignment(property)
            || propertyNameText(property.name) !== 'action'
          ) {
            continue;
          }

          if (
            ts.isStringLiteral(property.initializer)
            || ts.isNoSubstitutionTemplateLiteral(property.initializer)
          ) {
            actions.push(property.initializer.text);
          }
        }
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return actions;
}

function collectCommunityCallableRateLimitContracts(): readonly CommunityCallableRateLimitContract[] {
  const contracts: CommunityCallableRateLimitContract[] = [];

  for (const filePath of listProductionTypeScriptFiles(communitySourceDirectory)) {
    const fileName = path.relative(communitySourceDirectory, filePath);
    const sourceFile = parseTypeScriptFile(filePath);

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;

      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name)
          || !isOnCallInitializer(declaration.initializer)
        ) {
          continue;
        }

        const name = declaration.name.text;
        const expectedNonCentralWrapper = NON_CENTRAL_RATE_LIMIT_CALLABLES.get(
          name
        );

        contracts.push({
          name,
          fileName,
          canonicalActions: collectCanonicalRateLimitActions(
            declaration.initializer
          ),
          hasExpectedNonCentralWrapper: expectedNonCentralWrapper
            ? containsCallNamed(
              declaration.initializer,
              expectedNonCentralWrapper
            )
            : false,
        });
      }
    }
  }

  return contracts;
}

function contractLabels(
  contracts: readonly CommunityCallableRateLimitContract[]
): string[] {
  return contracts.map(({ name, fileName }) => `${name} (${fileName})`);
}

describe('Community anti-abuse architecture', () => {
  it('obriga toda callable a declarar leitura, antiabuso ou exceção temporária', () => {
    const contracts = collectCommunityCallableRateLimitContracts();
    const discoveredNames = new Set(contracts.map(({ name }) => name));
    const classifiedNames = new Set([
      ...READ_ONLY_CALLABLES,
      ...Object.keys(EXPECTED_CANONICAL_ACTION_BY_CALLABLE),
      ...DEFERRED_MUTATION_RATE_LIMIT_EXCEPTIONS.keys(),
      ...NON_CENTRAL_RATE_LIMIT_CALLABLES.keys(),
    ]);

    assert.ok(
      contracts.length > 0,
      'O contrato deve encontrar callables de Comunidades.'
    );

    const uncovered = contracts.filter(({ name }) => !classifiedNames.has(name));
    assert.deepEqual(
      uncovered,
      [],
      `Callables sem classificação de antiabuso:\n${contractLabels(uncovered).join('\n')}`
    );

    const obsoleteClassifications = Array.from(classifiedNames)
      .filter((name) => !discoveredNames.has(name));
    assert.deepEqual(
      obsoleteClassifications,
      [],
      `Classificações sem callable correspondente:\n${obsoleteClassifications.join('\n')}`
    );
  });

  it('mantém cada mutação protegida ligada à ação canônica correspondente', () => {
    const contracts = collectCommunityCallableRateLimitContracts();

    for (
      const [name, expectedAction]
      of Object.entries(EXPECTED_CANONICAL_ACTION_BY_CALLABLE)
    ) {
      const contract = contracts.find((candidate) => candidate.name === name);
      assert.ok(contract, `Callable protegida não encontrada: ${name}`);
      assert.deepEqual(
        contract.canonicalActions,
        [expectedAction],
        `${name} deve consumir exclusivamente a ação ${expectedAction}`
      );
    }
  });

  it('impede handlers Community de contornarem o adapter central', () => {
    const bypasses = listProductionTypeScriptFiles(communitySourceDirectory)
      .filter((filePath) =>
        readFileSync(filePath, 'utf8').includes('consumeBackendRateLimitQuota')
      )
      .map((filePath) => path.relative(communitySourceDirectory, filePath))
      .filter((fileName) => !DIRECT_BACKEND_RATE_LIMIT_ALLOWED_FILES.has(fileName))
      .sort();

    assert.deepEqual(bypasses, []);
  });

  it('mantém a exceção telemétrica protegida pelo wrapper específico', () => {
    const contracts = collectCommunityCallableRateLimitContracts();

    for (const [name] of NON_CENTRAL_RATE_LIMIT_CALLABLES) {
      const contract = contracts.find((candidate) => candidate.name === name);
      assert.ok(contract, `Callable telemétrica não encontrada: ${name}`);
      assert.equal(
        contract.canonicalActions.length,
        0,
        `${name}: telemetria não deve competir com o orçamento de mutações.`
      );
      assert.equal(
        contract.hasExpectedNonCentralWrapper,
        true,
        `${name}: o wrapper explícito de telemetria deve permanecer ativo.`
      );
    }
  });

  it('mantém exceções temporárias sem limiter canônico e documentadas', () => {
    const contracts = collectCommunityCallableRateLimitContracts();

    for (const [name, reason] of DEFERRED_MUTATION_RATE_LIMIT_EXCEPTIONS) {
      const contract = contracts.find((candidate) => candidate.name === name);
      assert.ok(contract, `Exceção temporária sem callable: ${name}`);
      assert.deepEqual(
        contract.canonicalActions,
        [],
        `${name}: remova a exceção ao adotar o limiter canônico.`
      );
      assert.ok(
        reason.trim().length >= 24,
        `${name}: a exceção precisa explicar o débito de segurança.`
      );
    }
  });

  it('mantém todo reason de rate limit coberto por mensagem segura de UX', () => {
    const frontendMessages = readFileSync(frontendRateLimitMessagesPath, 'utf8');
    const actions = Object.values(EXPECTED_CANONICAL_ACTION_BY_CALLABLE);

    for (const action of new Set(actions)) {
      const reason = getCommunityRateLimitPolicy(action).reason;
      assert.equal(
        frontendMessages.includes(`${reason}:`),
        true,
        `Mensagem ausente para ${reason}`
      );
    }
  });
});