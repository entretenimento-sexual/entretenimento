import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const ownershipLifecycleHandlerPath = path.resolve(
  __dirname,
  '../../src/community/community-ownership-lifecycle.handler.ts'
);

function parseOwnershipLifecycleHandler(): ts.SourceFile {
  return ts.createSourceFile(
    ownershipLifecycleHandlerPath,
    readFileSync(ownershipLifecycleHandlerPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function findVariableInitializer(
  sourceFile: ts.SourceFile,
  variableName: string
): ts.Expression | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === variableName
      ) {
        return declaration.initializer ?? null;
      }
    }
  }

  return null;
}

function containsNode(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean
): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (predicate(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(root);
  return found;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return null;
}

function isNegativeOne(expression: ts.Expression | undefined): boolean {
  return Boolean(
    expression
    && ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
    && expression.operand.text === '1'
  );
}

describe('community member-count wiring contract', () => {
  it('arquivamento usa o resolver central antes de persistir o novo memberCount', () => {
    const sourceFile = parseOwnershipLifecycleHandler();
    const archiveCommunity = findVariableInitializer(
      sourceFile,
      'archiveCommunity'
    );

    assert.ok(
      archiveCommunity,
      'O contrato deve encontrar a callable archiveCommunity.'
    );

    const importsCentralResolver = sourceFile.statements.some((statement) => {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== './community-member-count.policy'
      ) {
        return false;
      }

      const bindings = statement.importClause?.namedBindings;
      return Boolean(
        bindings
        && ts.isNamedImports(bindings)
        && bindings.elements.some(
          (element) => element.name.text === 'resolveCommunityMemberCountDelta'
        )
      );
    });

    assert.equal(
      importsCentralResolver,
      true,
      'archiveCommunity deve depender da policy canônica de memberCount.'
    );

    const resolvesDecrement = containsNode(archiveCommunity, (node) => {
      if (
        !ts.isCallExpression(node)
        || !ts.isIdentifier(node.expression)
        || node.expression.text !== 'resolveCommunityMemberCountDelta'
      ) {
        return false;
      }

      return node.arguments.length === 2 && isNegativeOne(node.arguments[1]);
    });

    assert.equal(
      resolvesDecrement,
      true,
      'archiveCommunity deve calcular a saída do proprietário via delta -1.'
    );

    const persistsResolvedCount = containsNode(archiveCommunity, (node) => {
      if (
        !ts.isPropertyAssignment(node)
        || propertyNameText(node.name) !== 'metrics.memberCount'
        || !ts.isIdentifier(node.initializer)
      ) {
        return false;
      }

      return node.initializer.text === 'nextMemberCount';
    });

    assert.equal(
      persistsResolvedCount,
      true,
      'archiveCommunity deve persistir o memberCount resolvido na mesma transação.'
    );
  });

  it('não reintroduz normalizador local permissivo no lifecycle de propriedade', () => {
    const sourceFile = parseOwnershipLifecycleHandler();
    const hasLocalNormalizer = sourceFile.statements.some((statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'normalizeMemberCount'
    );

    assert.equal(
      hasLocalNormalizer,
      false,
      'O lifecycle deve reutilizar a policy central em vez de normalizar memberCount localmente.'
    );
  });
});
