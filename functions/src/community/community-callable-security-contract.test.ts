import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const communitySourceDirectory = path.resolve(
  __dirname,
  '../../src/community'
);
const repositoryRoot = path.resolve(__dirname, '../../..');
const communityFrontendDirectory = path.join(
  repositoryRoot,
  'src/app/community'
);
const contentAccessPolicyModelPath = path.join(
  repositoryRoot,
  'src/app/core/access/content-access-policy.model.ts'
);
const ENFORCE_APP_CHECK_PATTERN =
  /enforceAppCheck:\s*REQUIRE_COMMUNITY_APP_CHECK/g;
const DEFENSIVE_APP_CHECK_PATTERN =
  /assertCommunityCallableAppCheck\(request\.app\);/g;
const COMMUNITY_REASON_MESSAGE_CATALOG_PATTERN = /_REASON_MESSAGES$/;
const ANONYMOUS_COMMUNITY_CALLABLE_ALLOWLIST: ReadonlySet<string> = new Set();
const SYNTHETIC_ON_CALL_NAME = 'onCall';

type RecentAuthenticationRequirement = 'always' | 'conditional' | 'none';

const COMMUNITY_CALLABLE_RECENT_AUTH_REQUIREMENTS =
  new Map<string, RecentAuthenticationRequirement>([
    ['community-feed-comment-moderation.handler.ts:moderateCommunityFeedComment', 'none'],
    ['community-feed-comment-reply-moderation.handler.ts:moderateCommunityFeedCommentReply', 'none'],
    ['community-feed-comment-reply-write.handler.ts:createCommunityFeedCommentReply', 'none'],
    ['community-feed-comment-write.handler.ts:createCommunityFeedComment', 'none'],
    ['community-feed-moderation.handler.ts:moderateCommunityFeedPost', 'none'],
    ['community-feed-reaction.handler.ts:toggleCommunityFeedReaction', 'none'],
    ['community-feed-write.handler.ts:createCommunityFeedPost', 'none'],
    ['community-highlight.handler.ts:manageCommunityHighlight', 'none'],
    ['community-invite-management.handler.ts:findCommunityInviteCandidate', 'none'],
    ['community-invite-management.handler.ts:getCommunitySentInvites', 'none'],
    ['community-member-management.handler.ts:getCommunityMembersForManagement', 'none'],
    ['community-member-management.handler.ts:manageCommunityMember', 'conditional'],
    ['community-membership-disclosure.handler.ts:updateCommunityMembershipDisclosurePolicy', 'none'],
    ['community-membership-management.handler.ts:getCommunityMembershipRequests', 'none'],
    ['community-membership-management.handler.ts:leaveCommunityMembership', 'none'],
    ['community-membership-management.handler.ts:reviewCommunityMembership', 'none'],
    ['community-membership-profile-visibility.handler.ts:getCommunityMembershipProfileVisibility', 'none'],
    ['community-membership-profile-visibility.handler.ts:updateCommunityMembershipProfileVisibility', 'none'],
    ['community-official-claim.handler.ts:submitCommunityOfficialClaim', 'always'],
    ['community-official-claim.handler.ts:reviewCommunityOfficialClaim', 'always'],
    ['community-ownership-lifecycle.handler.ts:getCommunityOwnershipCandidates', 'none'],
    ['community-ownership-lifecycle.handler.ts:transferCommunityOwnership', 'always'],
    ['community-ownership-lifecycle.handler.ts:archiveCommunity', 'always'],
    ['community-ownership-transfer.workflow.handler.ts:requestCommunityOwnershipTransfer', 'always'],
    ['community-ownership-transfer.workflow.handler.ts:getMyCommunityOwnershipTransfers', 'none'],
    ['community-ownership-transfer.workflow.handler.ts:respondCommunityOwnershipTransfer', 'always'],
    ['community-ownership-transfer.workflow.handler.ts:cancelCommunityOwnershipTransfer', 'always'],
    ['community-ownership-transfer.workflow.handler.ts:openCommunityOwnerTerminalSuccession', 'always'],
    ['community-topic-moderation.handler.ts:moderateCommunityTopic', 'none'],
    ['community-topic-write.handler.ts:createCommunityTopic', 'none'],
    ['community-topic-write.handler.ts:createCommunityTopicReply', 'none'],
    ['configure-community-ranking-mode.handler.ts:configureCommunityRankingMode', 'always'],
    ['create-community.handler.ts:createCommunity', 'none'],
    ['create-official-community.handler.ts:createOfficialCommunity', 'always'],
    ['create-venue-community.handler.ts:createVenueCommunity', 'always'],
    ['get-community-creation-capability.handler.ts:getCommunityCreationCapability', 'none'],
    ['get-community-discovery-page.handler.ts:getCommunityDiscoveryPage', 'none'],
    ['get-community-feed-comment-replies-page.handler.ts:getCommunityFeedCommentRepliesPage', 'none'],
    ['get-community-feed-comments-page.handler.ts:getCommunityFeedCommentsPage', 'none'],
    ['get-community-feed-items.handler.ts:getCommunityFeedItems', 'none'],
    ['get-community-feed-page.handler.ts:getCommunityFeedPage', 'none'],
    ['get-community-highlight.handler.ts:getCommunityHighlight', 'none'],
    ['get-community-invites.handler.ts:getCommunityInvites', 'none'],
    ['get-community-member-roster-page.handler.ts:getCommunityMemberRosterPage', 'none'],
    ['get-community-membership-context.handler.ts:getCommunityMembershipContext', 'none'],
    ['get-community-official-claim-capability.handler.ts:getCommunityOfficialClaimCapability', 'none'],
    ['get-community-official-claim-review-queue.handler.ts:getCommunityOfficialClaimReviewQueue', 'none'],
    ['get-community-ownership-candidates-page.handler.ts:getCommunityOwnershipCandidatesPage', 'none'],
    ['get-community-preview.handler.ts:getCommunityPreview', 'none'],
    ['get-community-tag-catalog.handler.ts:getCommunityTagCatalog', 'none'],
    ['get-community-topic-detail.handler.ts:getCommunityTopicDetail', 'none'],
    ['get-community-topic-detail.handler.ts:getCommunityTopicRepliesPage', 'none'],
    ['get-community-topics-page.handler.ts:getCommunityTopicsPage', 'none'],
    ['get-my-communities-page.handler.ts:getMyCommunitiesPage', 'none'],
    ['get-my-community-official-claim.handler.ts:getMyCommunityOfficialClaim', 'none'],
    ['get-official-communities-for-target.handler.ts:getOfficialCommunitiesForTarget', 'none'],
    ['get-profile-official-communities.handler.ts:getProfileOfficialCommunities', 'none'],
    ['get-profile-public-communities.handler.ts:getProfilePublicCommunities', 'none'],
    ['inspect-community-purge-readiness.handler.ts:inspectCommunityPurgeReadiness', 'none'],
    ['inspect-community-ranking-readiness.handler.ts:inspectCommunityRankingReadiness', 'none'],
    ['reconcile-community-member-counts.handler.ts:reconcileCommunityMemberCounts', 'always'],
    ['record-community-discovery-exposure.handler.ts:recordCommunityDiscoveryExposure', 'none'],
    ['report-community-feed-comment-reply.handler.ts:reportCommunityFeedCommentReply', 'none'],
    ['report-community-feed-comment.handler.ts:reportCommunityFeedComment', 'none'],
    ['report-community-feed-post.handler.ts:reportCommunityFeedPost', 'none'],
    ['request-community-membership.handler.ts:requestCommunityMembership', 'none'],
    ['respond-community-invite.handler.ts:acceptCommunityInvite', 'none'],
    ['respond-community-invite.handler.ts:declineCommunityInvite', 'none'],
    ['review-community-feed-comment-reply-report.handler.ts:reviewCommunityFeedCommentReplyReport', 'none'],
    ['review-community-feed-comment-report.handler.ts:reviewCommunityFeedCommentReport', 'none'],
    ['review-community-feed-post-report.handler.ts:reviewCommunityFeedPostReport', 'none'],
    ['revoke-community-invite.handler.ts:revokeCommunityInvite', 'none'],
    ['send-community-invite.handler.ts:sendCommunityInvite', 'none'],
    ['update-community-notification-preference.handler.ts:updateCommunityNotificationPreference', 'none'],
    ['update-community-settings.handler.ts:updateCommunitySettings', 'conditional'],
  ]);

type CallableHandler = ts.ArrowFunction | ts.FunctionExpression;
type ResolvedFunction =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression;

interface CommunityCallableFile {
  readonly fileName: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly callableCount: number;
}

interface CommunityCallableDefinition {
  readonly fileName: string;
  readonly name: string;
  readonly sourceFile: ts.SourceFile;
  readonly handler: CallableHandler | null;
}

type AuthenticationClassification =
  | 'authenticated'
  | 'anonymous'
  | 'unrecognized';

interface CommunityErrorContractEntry {
  readonly fileName: string;
  readonly reason: string | null;
  readonly recommendedAction: string | null;
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

function callableKey(
  callable: Pick<CommunityCallableDefinition, 'fileName' | 'name'>
): string {
  return `${callable.fileName}:${callable.name}`;
}

function listTypeScriptFiles(
  directory: string,
  options: { readonly excludeTests?: boolean } = {}
): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listTypeScriptFiles(entryPath, options);
      }

      if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
      if (
        options.excludeTests
        && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))
      ) {
        return [];
      }

      return [entryPath];
    });
}

function parseTypeScriptFile(filePath: string): ts.SourceFile {
  return parseTypeScriptSource(filePath, readFileSync(filePath, 'utf8'));
}

function parseTypeScriptSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function collectCommunityCallableFiles(): readonly CommunityCallableFile[] {
  return listTypeScriptFiles(
    communitySourceDirectory,
    { excludeTests: true }
  )
    .map((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      const sourceFile = parseTypeScriptSource(filePath, source);

      return {
        fileName: path.relative(communitySourceDirectory, filePath),
        source,
        sourceFile,
        callableCount: countOnCallExpressions(sourceFile),
      };
    })
    .filter(({ callableCount }) => callableCount > 0);
}

function expressionName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function countOnCallExpressions(sourceFile: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && expressionName(node.expression) === 'onCall'
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function collectCommunityCallables(
  callableFiles: readonly CommunityCallableFile[]
): readonly CommunityCallableDefinition[] {
  const callables: CommunityCallableDefinition[] = [];

  for (const callableFile of callableFiles) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && expressionName(node.expression) === 'onCall'
      ) {
        const declaration = node.parent;
        const name = ts.isVariableDeclaration(declaration)
          && ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : `<onCall@${callableFile.sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}>`;
        const handler = [...node.arguments]
          .reverse()
          .find((argument): argument is CallableHandler =>
            ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
          ) ?? null;

        callables.push({
          fileName: callableFile.fileName,
          name,
          sourceFile: callableFile.sourceFile,
          handler,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(callableFile.sourceFile);
  }

  return callables;
}

function functionParameterNames(
  functionLike: ResolvedFunction | CallableHandler
): readonly (string | null)[] {
  return functionLike.parameters.map((parameter) =>
    ts.isIdentifier(parameter.name) ? parameter.name.text : null
  );
}

function functionStatements(
  functionLike: ResolvedFunction | CallableHandler
): readonly ts.Statement[] {
  return functionLike.body && ts.isBlock(functionLike.body)
    ? functionLike.body.statements
    : [];
}

function visitWithoutNestedFunctions(
  node: ts.Node,
  visitor: (current: ts.Node) => void
): void {
  const visit = (current: ts.Node): void => {
    if (
      current !== node
      && (
        ts.isArrowFunction(current)
        || ts.isFunctionDeclaration(current)
        || ts.isFunctionExpression(current)
      )
    ) {
      return;
    }

    visitor(current);
    ts.forEachChild(current, visit);
  };

  visit(node);
}

function propertyAccessName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node)
    && node.argumentExpression
    && ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }

  return null;
}

function propertyAccessTarget(node: ts.Node): ts.Expression | null {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? node.expression
    : null;
}

function isRequestAuthAccess(node: ts.Node, requestName: string): boolean {
  const target = propertyAccessTarget(node);
  return propertyAccessName(node) === 'auth'
    && target !== null
    && ts.isIdentifier(target)
    && target.text === requestName;
}

interface AuthenticationSources {
  readonly authObjects: ReadonlySet<string>;
  readonly uids: ReadonlySet<string>;
  readonly requestName: string | null;
}

function isAuthObjectExpression(
  expression: ts.Expression,
  sources: AuthenticationSources
): boolean {
  const current = unwrapExpression(expression);
  if (
    sources.requestName !== null
    && isRequestAuthAccess(current, sources.requestName)
  ) {
    return true;
  }
  if (ts.isIdentifier(current)) return sources.authObjects.has(current.text);
  if (
    ts.isBinaryExpression(current)
    && current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && ts.isObjectLiteralExpression(unwrapExpression(current.right))
    && (unwrapExpression(current.right) as ts.ObjectLiteralExpression).properties.length === 0
  ) {
    return isAuthObjectExpression(current.left, sources);
  }
  return false;
}

function isEmptyUidFallback(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return current.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(current) && current.text === 'undefined')
    || (ts.isStringLiteral(current) && current.text === '');
}

function isUidExpression(
  expression: ts.Expression,
  sources: AuthenticationSources
): boolean {
  const current = unwrapExpression(expression);
  const target = propertyAccessTarget(current);
  if (
    propertyAccessName(current) === 'uid'
    && target !== null
    && isAuthObjectExpression(target, sources)
  ) {
    return true;
  }
  if (ts.isIdentifier(current)) return sources.uids.has(current.text);
  if (
    ts.isBinaryExpression(current)
    && (
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      || current.operatorToken.kind === ts.SyntaxKind.BarBarToken
    )
  ) {
    return isUidExpression(current.left, sources)
      && isEmptyUidFallback(current.right);
  }
  if (ts.isCallExpression(current)) {
    if (
      ts.isPropertyAccessExpression(current.expression)
      && current.expression.name.text === 'trim'
      && current.arguments.length === 0
    ) {
      return isUidExpression(current.expression.expression, sources);
    }
    if (
      ts.isIdentifier(current.expression)
      && [
        'String',
        'cleanId',
        'normalizeSafeId',
        'normalizeCommunityInviteText',
      ].includes(current.expression.text)
      && current.arguments[0] !== undefined
    ) {
      if (current.expression.text === 'String') {
        const argument = unwrapExpression(current.arguments[0]);
        return ts.isBinaryExpression(argument)
          && (
            argument.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
            || argument.operatorToken.kind === ts.SyntaxKind.BarBarToken
          )
          && ts.isStringLiteral(unwrapExpression(argument.right))
          && (unwrapExpression(argument.right) as ts.StringLiteral).text === ''
          && isUidExpression(argument.left, sources);
      }
      return isUidExpression(current.arguments[0], sources);
    }
  }
  return false;
}

function collectAuthenticationSources(
  functionLike: ResolvedFunction | CallableHandler,
  initialSources: AuthenticationSources
): AuthenticationSources {
  const authObjects = new Set(initialSources.authObjects);
  const uids = new Set(initialSources.uids);
  let changed = true;

  while (changed) {
    changed = false;
    const sources = { authObjects, uids, requestName: initialSources.requestName };

    for (const statement of functionStatements(functionLike)) {
      visitWithoutNestedFunctions(statement, (node) => {
        if (
          !ts.isVariableDeclaration(node)
          || !ts.isIdentifier(node.name)
          || !node.initializer
        ) {
          return;
        }

        if (
          !authObjects.has(node.name.text)
          && isAuthObjectExpression(node.initializer, sources)
        ) {
          authObjects.add(node.name.text);
          changed = true;
        }
        if (!uids.has(node.name.text) && isUidExpression(node.initializer, sources)) {
          uids.add(node.name.text);
          changed = true;
        }
      });
    }
  }

  return { authObjects, uids, requestName: initialSources.requestName };
}

function isUnauthenticatedHttpsError(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isNewExpression(unwrapped)
    && isHttpsErrorConstructor(unwrapped.expression)
    && unwrapped.arguments?.[0] !== undefined
    && literalStringValue(unwrapped.arguments[0]) === 'unauthenticated';
}

function isDirectUnauthenticatedThrow(statement: ts.Statement): boolean {
  const directStatement = ts.isBlock(statement)
    && statement.statements.length === 1
    ? statement.statements[0]
    : statement;
  return ts.isThrowStatement(directStatement)
    && directStatement.expression !== undefined
    && isUnauthenticatedHttpsError(directStatement.expression);
}

function isNonemptyUidPatternTest(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  sources: AuthenticationSources
): boolean {
  const current = unwrapExpression(expression);
  if (
    !ts.isCallExpression(current)
    || !ts.isPropertyAccessExpression(current.expression)
    || current.expression.name.text !== 'test'
    || !ts.isIdentifier(current.expression.expression)
    || current.arguments.length !== 1
    || !isUidExpression(current.arguments[0], sources)
  ) {
    return false;
  }

  const patternName = current.expression.expression.text;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === patternName
        && declaration.initializer
        && ts.isRegularExpressionLiteral(declaration.initializer)
      ) {
        const literal = declaration.initializer.text;
        const lastSlash = literal.lastIndexOf('/');
        const pattern = new RegExp(
          literal.slice(1, lastSlash),
          literal.slice(lastSlash + 1)
        );
        return !pattern.test('');
      }
    }
  }
  return false;
}

function statementRejectsMissingAuthentication(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  sources: AuthenticationSources
): boolean {
  if (!ts.isIfStatement(statement)) return false;
  const condition = unwrapExpression(statement.expression);
  return ts.isPrefixUnaryExpression(condition)
    && condition.operator === ts.SyntaxKind.ExclamationToken
    && (
      isUidExpression(condition.operand, sources)
      || isNonemptyUidPatternTest(sourceFile, condition.operand, sources)
    )
    && isDirectUnauthenticatedThrow(statement.thenStatement);
}

function findLocalFunction(
  sourceFile: ts.SourceFile,
  functionName: string
): ResolvedFunction | null {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === functionName
      && statement.body
    ) {
      return statement;
    }

    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === functionName
        && declaration.initializer
      ) {
        const initializer = unwrapExpression(declaration.initializer);
        if (
          ts.isArrowFunction(initializer)
          || ts.isFunctionExpression(initializer)
        ) {
          return initializer;
        }
      }
    }
  }

  return null;
}

function resolveRelativeTypeScriptModule(
  sourceFile: ts.SourceFile,
  moduleName: string
): ts.SourceFile | null {
  if (!moduleName.startsWith('.')) return null;

  const basePath = path.resolve(path.dirname(sourceFile.fileName), moduleName);
  const candidates = moduleName.endsWith('.js')
    ? [basePath.slice(0, -3) + '.ts']
    : [`${basePath}.ts`, path.join(basePath, 'index.ts')];

  for (const candidate of candidates) {
    try {
      return parseTypeScriptFile(candidate);
    } catch {
      // A resolução conservadora ignora apenas módulos que não existem.
    }
  }

  return null;
}

function resolveCalledFunction(
  sourceFile: ts.SourceFile,
  functionName: string
): { readonly sourceFile: ts.SourceFile; readonly functionLike: ResolvedFunction } | null {
  const localFunction = findLocalFunction(sourceFile, functionName);
  if (localFunction) return { sourceFile, functionLike: localFunction };

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.importClause?.namedBindings
      || !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    const importSpecifier = statement.importClause.namedBindings.elements.find(
      (element) => element.name.text === functionName
    );
    if (!importSpecifier) continue;

    const importedSourceFile = resolveRelativeTypeScriptModule(
      sourceFile,
      statement.moduleSpecifier.text
    );
    if (!importedSourceFile) return null;

    const importedName = importSpecifier.propertyName?.text ?? importSpecifier.name.text;
    const importedFunction = findLocalFunction(importedSourceFile, importedName);
    return importedFunction
      ? { sourceFile: importedSourceFile, functionLike: importedFunction }
      : null;
  }

  return null;
}

function statementCallExpressions(statement: ts.Statement): readonly ts.CallExpression[] {
  const expressions = ts.isExpressionStatement(statement)
    ? [statement.expression]
    : ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
        .flatMap((declaration) => declaration.initializer ? [declaration.initializer] : [])
      : ts.isReturnStatement(statement) && statement.expression
        ? [statement.expression]
        : [];
  return expressions
    .map(unwrapExpression)
    .filter((expression): expression is ts.CallExpression =>
      ts.isCallExpression(expression)
    );
}

function functionEstablishesAuthentication(
  sourceFile: ts.SourceFile,
  functionLike: ResolvedFunction | CallableHandler,
  initialSources: AuthenticationSources,
  visited: Set<string>
): boolean {
  const sources = collectAuthenticationSources(
    functionLike,
    initialSources
  );
  const visitKey = [
    sourceFile.fileName,
    functionLike.pos,
    ...[...initialSources.authObjects].sort(),
    '|',
    ...[...initialSources.uids].sort(),
  ].join(':');

  if (visited.has(visitKey)) return false;
  visited.add(visitKey);

  for (const statement of functionStatements(functionLike)) {
    if (statementRejectsMissingAuthentication(sourceFile, statement, sources)) {
      return true;
    }

    for (const call of statementCallExpressions(statement)) {
      if (!ts.isIdentifier(call.expression)) continue;

      const resolved = resolveCalledFunction(sourceFile, call.expression.text);
      if (!resolved) continue;

      const parameterNames = functionParameterNames(resolved.functionLike);
      const authObjects = new Set<string>();
      const uids = new Set<string>();

      call.arguments.forEach((argument, index) => {
        const parameterName = parameterNames[index];
        if (!parameterName) return;
        if (isAuthObjectExpression(argument, sources)) authObjects.add(parameterName);
        if (isUidExpression(argument, sources)) uids.add(parameterName);
      });

      if (
        (authObjects.size > 0 || uids.size > 0)
        && functionEstablishesAuthentication(
          resolved.sourceFile,
          resolved.functionLike,
          { authObjects, uids, requestName: null },
          visited
        )
      ) {
        return true;
      }
    }

    let returnsBeforeGuard = false;
    visitWithoutNestedFunctions(statement, (node) => {
      if (ts.isReturnStatement(node)) returnsBeforeGuard = true;
    });
    if (returnsBeforeGuard) return false;
  }

  return false;
}

function classifyCallableAuthentication(
  callable: CommunityCallableDefinition,
  anonymousAllowlist: ReadonlySet<string>
): AuthenticationClassification {
  if (anonymousAllowlist.has(callableKey(callable))) return 'anonymous';
  if (!callable.handler) return 'unrecognized';

  const requestName = functionParameterNames(callable.handler)[0];
  if (!requestName) return 'unrecognized';

  return functionEstablishesAuthentication(
    callable.sourceFile,
    callable.handler,
    { authObjects: new Set(), uids: new Set(), requestName },
    new Set()
  )
    ? 'authenticated'
    : 'unrecognized';
}

function classifySyntheticCallables(
  source: string,
  anonymousAllowlist: ReadonlySet<string> = new Set()
): readonly AuthenticationClassification[] {
  const filePath = path.join(communitySourceDirectory, 'synthetic.ts');
  const sourceFile = parseTypeScriptSource(filePath, source);
  const callableFiles: readonly CommunityCallableFile[] = [{
    fileName: 'synthetic.ts',
    source,
    sourceFile,
    callableCount: countOnCallExpressions(sourceFile),
  }];

  return collectCommunityCallables(callableFiles).map((callable) =>
    classifyCallableAuthentication(callable, anonymousAllowlist)
  );
}

function collectSyntheticCommunityCallables(
  source: string
): readonly CommunityCallableDefinition[] {
  const filePath = path.join(communitySourceDirectory, 'synthetic.ts');
  const sourceFile = parseTypeScriptSource(filePath, source);
  const callableFiles: readonly CommunityCallableFile[] = [{
    fileName: 'synthetic.ts',
    source,
    sourceFile,
    callableCount: countOnCallExpressions(sourceFile),
  }];

  return collectCommunityCallables(callableFiles);
}

function callableHasRecentAuthenticationAssertion(
  callable: CommunityCallableDefinition
): boolean {
  if (!callable.handler) return false;

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'assertRecentAuthentication'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(callable.handler);
  return found;
}

function collectRecentAuthenticationInventoryIssues(
  callables: readonly CommunityCallableDefinition[],
  requirements: ReadonlyMap<string, RecentAuthenticationRequirement>
): readonly string[] {
  const issues: string[] = [];
  const discovered = new Map(
    callables.map((callable) => [callableKey(callable), callable] as const)
  );

  for (const key of discovered.keys()) {
    if (!requirements.has(key)) {
      issues.push(`${key}: recent-auth classification missing`);
    }
  }

  for (const key of requirements.keys()) {
    if (!discovered.has(key)) {
      issues.push(`${key}: stale recent-auth classification`);
    }
  }

  for (const [key, requirement] of requirements) {
    const callable = discovered.get(key);
    if (!callable) continue;

    const hasAssertion = callableHasRecentAuthenticationAssertion(callable);
    if (requirement === 'none' && hasAssertion) {
      issues.push(`${key}: unexpected recent-auth assertion`);
    } else if (requirement !== 'none' && !hasAssertion) {
      issues.push(`${key}: recent-auth assertion required`);
    }
  }

  return issues.sort();
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return null;
}

function literalStringValue(expression: ts.Expression): string | null {
  return ts.isStringLiteral(expression)
    || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : null;
}

function objectLiteralStringProperty(
  expression: ts.Expression | undefined,
  propertyName: string
): string | null {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return null;

  for (const property of expression.properties) {
    if (
      !ts.isPropertyAssignment(property)
      || propertyNameText(property.name) !== propertyName
    ) {
      continue;
    }

    return literalStringValue(property.initializer);
  }

  return null;
}

function isHttpsErrorConstructor(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression)
    ? expression.text === 'HttpsError'
    : ts.isPropertyAccessExpression(expression)
      && expression.name.text === 'HttpsError';
}

function collectCommunityErrorContracts(): readonly CommunityErrorContractEntry[] {
  const entries: CommunityErrorContractEntry[] = [];

  for (
    const filePath of listTypeScriptFiles(
      communitySourceDirectory,
      { excludeTests: true }
    )
  ) {
    const sourceFile = parseTypeScriptFile(filePath);

    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node)
        && isHttpsErrorConstructor(node.expression)
      ) {
        const details = node.arguments?.[2];
        const reason = objectLiteralStringProperty(details, 'reason');
        const recommendedAction = objectLiteralStringProperty(
          details,
          'recommendedAction'
        );

        if (reason || recommendedAction) {
          entries.push({
            fileName: path.relative(communitySourceDirectory, filePath),
            reason,
            recommendedAction,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return entries;
}

function unwrapObjectLiteral(
  expression: ts.Expression | undefined
): ts.ObjectLiteralExpression | null {
  if (!expression) return null;
  if (ts.isObjectLiteralExpression(expression)) return expression;

  if (
    ts.isCallExpression(expression)
    && expression.arguments.length === 1
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === 'Object'
    && expression.expression.name.text === 'freeze'
    && ts.isObjectLiteralExpression(expression.arguments[0])
  ) {
    return expression.arguments[0];
  }

  return null;
}

function collectCatalogKeys(
  filePath: string,
  catalogNamePattern: RegExp
): ReadonlySet<string> {
  const sourceFile = parseTypeScriptFile(filePath);
  const keys = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name)
        || !catalogNamePattern.test(declaration.name.text)
      ) {
        continue;
      }

      const objectLiteral = unwrapObjectLiteral(declaration.initializer);
      if (!objectLiteral) continue;

      for (const property of objectLiteral.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = propertyNameText(property.name);
        if (key) keys.add(key);
      }
    }
  }

  return keys;
}

function collectCommunityFrontendReasonMessageKeys(): ReadonlySet<string> {
  const keys = new Set<string>();

  for (
    const filePath of listTypeScriptFiles(
      communityFrontendDirectory,
      { excludeTests: true }
    )
  ) {
    for (
      const key of collectCatalogKeys(
        filePath,
        COMMUNITY_REASON_MESSAGE_CATALOG_PATTERN
      )
    ) {
      keys.add(key);
    }
  }

  return keys;
}

function collectStringLiteralTypeMembers(
  filePath: string,
  typeName: string
): ReadonlySet<string> {
  const sourceFile = parseTypeScriptFile(filePath);
  const values = new Set<string>();

  const collect = (typeNode: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(typeNode)) {
      typeNode.types.forEach(collect);
      return;
    }

    if (
      ts.isLiteralTypeNode(typeNode)
      && ts.isStringLiteral(typeNode.literal)
    ) {
      values.add(typeNode.literal.text);
    }
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isTypeAliasDeclaration(statement)
      && statement.name.text === typeName
    ) {
      collect(statement.type);
    }
  }

  return values;
}

function formatMissingEntries(
  entries: readonly CommunityErrorContractEntry[],
  field: 'reason' | 'recommendedAction'
): string {
  return entries
    .map((entry) => `${entry.fileName}: ${entry[field]}`)
    .join('\n');
}

describe('community-callable-security contract', () => {
  it('protege toda callable de Comunidades com App Check e asserção defensiva', () => {
    const callableFiles = collectCommunityCallableFiles();

    assert.ok(
      callableFiles.length > 0,
      'O contrato deve encontrar ao menos uma callable de Comunidades.'
    );

    for (const { fileName, source, callableCount } of callableFiles) {
      assert.equal(
        countMatches(source, ENFORCE_APP_CHECK_PATTERN),
        callableCount,
        `${fileName}: cada onCall deve habilitar Community App Check.`
      );
      assert.equal(
        countMatches(source, DEFENSIVE_APP_CHECK_PATTERN),
        callableCount,
        `${fileName}: cada onCall deve validar request.app defensivamente.`
      );
    }
  });

  it('exige autenticação fail-closed em toda callable não anônima', () => {
    const callableFiles = collectCommunityCallableFiles();
    const callables = collectCommunityCallables(callableFiles);
    const discoveredCount = callableFiles.reduce(
      (total, file) => total + file.callableCount,
      0
    );
    const unrecognized = callables
      .filter((callable) =>
        classifyCallableAuthentication(
          callable,
          ANONYMOUS_COMMUNITY_CALLABLE_ALLOWLIST
        ) === 'unrecognized'
      )
      .map(callableKey);

    assert.equal(
      callables.length,
      discoveredCount,
      'O inventário AST deve classificar toda onCall descoberta dinamicamente.'
    );
    assert.equal(
      ANONYMOUS_COMMUNITY_CALLABLE_ALLOWLIST.size,
      0,
      'Não existem callables anônimas de Comunidades no contrato atual.'
    );
    assert.deepEqual(
      unrecognized,
      [],
      `Callables sem autenticação fail-closed reconhecida:\n${unrecognized.join('\n')}`
    );
  });
  it('classifica recent-auth de toda callable e exige a proteção nos caminhos sensíveis', () => {
    const callableFiles = collectCommunityCallableFiles();
    const callables = collectCommunityCallables(callableFiles);
    const issues = collectRecentAuthenticationInventoryIssues(
      callables,
      COMMUNITY_CALLABLE_RECENT_AUTH_REQUIREMENTS
    );

    assert.deepEqual(
      issues,
      [],
      `Contrato de recent-auth inconsistente:\n${issues.join('\n')}`
    );
  });
});

describe('community-callable authentication classifier', () => {
  it('rejeita callable com App Check mas sem autenticação', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const appCheckOnly = ${SYNTHETIC_ON_CALL_NAME}(
          { enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK },
          async (request) => {
            assertCommunityCallableAppCheck(request.app);
            return { ok: true };
          }
        );
      `),
      ['unrecognized']
    );
  });

  it('rejeita leitura opcional de request.auth.uid sem fail-closed', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const optionalAuthRead = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = request.auth?.uid;
          return { uid };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita guarda invertido que deixa passar UID ausente', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const invertedGuard = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = request.auth?.uid ?? null;
          if (uid) throw new HttpsError('unauthenticated', 'Inverso.');
          return { ok: true };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita fallback de UID que aceita chamada anônima', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const fallbackUid = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = request.auth?.uid ?? 'guest';
          if (!uid) throw new HttpsError('unauthenticated', 'Sem UID.');
          return { uid };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita auth substituído por objeto com UID padrão', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const fallbackAuth = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const auth = request.auth ?? { uid: 'guest' };
          if (!auth.uid) throw new HttpsError('unauthenticated', 'Sem UID.');
          return { uid: auth.uid };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita String de UID ausente sem fallback vazio', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const stringifiedMissingUid = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = String(request.auth?.uid);
          if (!uid) throw new HttpsError('unauthenticated', 'Sem UID.');
          return { uid };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita guarda sobre token sem exigir UID', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const tokenOnly = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const token = request.auth?.token;
          if (!token) throw new HttpsError('unauthenticated', 'Sem token.');
          return { ok: true };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita padrão de UID que aceita string vazia', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        const EMPTY_UID_PATTERN = /^.*$/;
        export const emptyUidPattern = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = request.auth?.uid ?? '';
          if (!EMPTY_UID_PATTERN.test(uid)) {
            throw new HttpsError('unauthenticated', 'Sem UID.');
          }
          return { uid };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita guarda chamado apenas em um ramo opcional', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        function assertAuthenticated(auth: { uid?: string } | undefined) {
          const uid = auth?.uid ?? null;
          if (!uid) throw new HttpsError('unauthenticated', 'Sem UID.');
        }
        export const optionalGuard = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          if (request.data?.check) assertAuthenticated(request.auth);
          return { ok: true };
        });
      `),
      ['unrecognized']
    );
  });

  it('rejeita retorno anterior ao guarda de autenticação', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const earlyReturn = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          if (request.data?.skip) return { ok: true };
          const uid = request.auth?.uid ?? null;
          if (!uid) throw new HttpsError('unauthenticated', 'Sem UID.');
          return { uid };
        });
      `),
      ['unrecognized']
    );
  });

  it('inclui onCall fora de atribuição no inventário e rejeita ausência de auth', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export function createCallable() {
          return onCall(async () => ({ ok: true }));
        }
      `),
      ['unrecognized']
    );
  });

  it('aceita guarda local ligado ao auth e com rejeição unauthenticated', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        function assertAuthenticated(auth: { uid?: string } | undefined): string {
          const uid = String(auth?.uid ?? '').trim();
          if (!uid) {
            throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
          }
          return uid;
        }

        export const guardedLocally = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = assertAuthenticated(request.auth);
          return { uid };
        });
      `),
      ['authenticated']
    );
  });

  it('aceita guarda compartilhado importado e comprovadamente fail-closed', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        import {
          assertCommunityInviteAuthenticatedUid,
        } from './community-invite.shared';

        export const guardedBySharedHelper = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = assertCommunityInviteAuthenticatedUid(request.auth);
          return { uid };
        });
      `),
      ['authenticated']
    );
  });

  it('aceita padrão de UID que rejeita string vazia', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        const SAFE_UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
        export const nonemptyUidPattern = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
          const uid = request.auth?.uid ?? '';
          if (!SAFE_UID_PATTERN.test(uid)) {
            throw new HttpsError('unauthenticated', 'Sem UID.');
          }
          return { uid };
        });
      `),
      ['authenticated']
    );
  });

  it('aceita callable deliberadamente anônima somente quando allowlisted', () => {
    assert.deepEqual(
      classifySyntheticCallables(
        `
          export const anonymousCallable = ${SYNTHETIC_ON_CALL_NAME}(async () => ({ ok: true }));
        `,
        new Set(['synthetic.ts:anonymousCallable'])
      ),
      ['anonymous']
    );
  });

  it('rejeita callable sem autenticação quando está fora da allowlist', () => {
    assert.deepEqual(
      classifySyntheticCallables(`
        export const missingFromAllowlist = ${SYNTHETIC_ON_CALL_NAME}(async () => ({ ok: true }));
      `),
      ['unrecognized']
    );
  });
});

describe('community-error transport contract', () => {
  it('mantém todo reason literal emitido pelo backend coberto por mensagem segura', () => {
    const contracts = collectCommunityErrorContracts();
    const reasonMessages = collectCommunityFrontendReasonMessageKeys();
    const missing = contracts.filter(
      (entry) => entry.reason && !reasonMessages.has(entry.reason)
    );

    assert.ok(
      contracts.length > 0,
      'O contrato deve encontrar erros estruturados do domínio Comunidades.'
    );
    assert.deepEqual(
      missing,
      [],
      `Reasons sem mensagem segura no frontend:\n${formatMissingEntries(
        missing,
        'reason'
      )}`
    );
  });

  it('mantém recommendedAction emitida pelo backend dentro do vocabulário de UX', () => {
    const contracts = collectCommunityErrorContracts();
    const supportedActions = new Set([
      ...collectStringLiteralTypeMembers(
        contentAccessPolicyModelPath,
        'ContentAccessRecommendedAction'
      ),
      'retry_later',
    ]);
    const missing = contracts.filter(
      (entry) => entry.recommendedAction
        && !supportedActions.has(entry.recommendedAction)
    );

    assert.deepEqual(
      missing,
      [],
      `recommendedAction sem contrato de UX:\n${formatMissingEntries(
        missing,
        'recommendedAction'
      )}`
    );
  });
});


describe('community-callable recent-auth classifier', () => {
  it('rejeita callable nova sem classificação explícita', () => {
    const callables = collectSyntheticCommunityCallables(`
      export const newSensitiveCallable = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
        return { uid: request.auth?.uid ?? null };
      });
    `);

    assert.deepEqual(
      collectRecentAuthenticationInventoryIssues(callables, new Map()),
      ['synthetic.ts:newSensitiveCallable: recent-auth classification missing']
    );
  });

  it('rejeita callable sensível sem assertRecentAuthentication real no AST', () => {
    const callables = collectSyntheticCommunityCallables(`
      export const sensitiveCallable = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
        const marker = 'assertRecentAuthentication(request.auth?.token)';
        return { marker };
      });
    `);
    const requirements = new Map<string, RecentAuthenticationRequirement>([
      ['synthetic.ts:sensitiveCallable', 'always'],
    ]);

    assert.deepEqual(
      collectRecentAuthenticationInventoryIssues(callables, requirements),
      ['synthetic.ts:sensitiveCallable: recent-auth assertion required']
    );
  });

  it('aceita callable sensível com assertRecentAuthentication no AST', () => {
    const callables = collectSyntheticCommunityCallables(`
      export const sensitiveCallable = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
        assertRecentAuthentication(request.auth?.token);
        return { ok: true };
      });
    `);
    const requirements = new Map<string, RecentAuthenticationRequirement>([
      ['synthetic.ts:sensitiveCallable', 'always'],
    ]);

    assert.deepEqual(
      collectRecentAuthenticationInventoryIssues(callables, requirements),
      []
    );
  });

  it('rejeita classificação none quando o runtime ganha recent-auth', () => {
    const callables = collectSyntheticCommunityCallables(`
      export const ordinaryCallable = ${SYNTHETIC_ON_CALL_NAME}(async (request) => {
        assertRecentAuthentication(request.auth?.token);
        return { ok: true };
      });
    `);
    const requirements = new Map<string, RecentAuthenticationRequirement>([
      ['synthetic.ts:ordinaryCallable', 'none'],
    ]);

    assert.deepEqual(
      collectRecentAuthenticationInventoryIssues(callables, requirements),
      ['synthetic.ts:ordinaryCallable: unexpected recent-auth assertion']
    );
  });
});
