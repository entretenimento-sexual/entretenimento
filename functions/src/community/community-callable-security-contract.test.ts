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
const ON_CALL_ASSIGNMENT_PATTERN = /=\s*onCall\s*(?:<|\()/g;
const ENFORCE_APP_CHECK_PATTERN =
  /enforceAppCheck:\s*REQUIRE_COMMUNITY_APP_CHECK/g;
const DEFENSIVE_APP_CHECK_PATTERN =
  /assertCommunityCallableAppCheck\(request\.app\);/g;
const COMMUNITY_REASON_MESSAGE_CATALOG_PATTERN = /_REASON_MESSAGES$/;

interface CommunityErrorContractEntry {
  readonly fileName: string;
  readonly reason: string | null;
  readonly recommendedAction: string | null;
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
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
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
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
    const callableFiles = readdirSync(communitySourceDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => {
        const source = readFileSync(
          path.join(communitySourceDirectory, fileName),
          'utf8'
        );

        return {
          fileName,
          source,
          callableCount: countMatches(source, ON_CALL_ASSIGNMENT_PATTERN),
        };
      })
      .filter(({ callableCount }) => callableCount > 0);

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
