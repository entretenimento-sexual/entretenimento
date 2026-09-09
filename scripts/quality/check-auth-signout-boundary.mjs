// scripts/quality/check-auth-signout-boundary.mjs
// -----------------------------------------------------------------------------
// AUTH SIGNOUT BOUNDARY CHECK
// -----------------------------------------------------------------------------
// `LogoutService` é a única fronteira autorizada a chamar o Firebase Auth
// `signOut`. Features e serviços de leitura de sessão devem usar AuthFacade /
// LogoutService para preservar cleanup de presence, geolocalização, Web Push e
// caches sensíveis.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const appRoot = path.join(root, 'src', 'app');
const canonicalRelativePath = path.normalize(
  'src/app/core/services/autentication/auth/logout.service.ts'
);
const firebaseAuthModules = new Set(['@angular/fire/auth', 'firebase/auth']);

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

function collectRawSignOutBindings(sourceFile) {
  const directBindings = new Set();
  const namespaceBindings = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!firebaseAuthModules.has(statement.moduleSpecifier.text)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;

    if (ts.isNamespaceImport(bindings)) {
      namespaceBindings.add(bindings.name.text);
      continue;
    }

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'signOut') {
        directBindings.add(element.name.text);
      }
    }
  }

  return { directBindings, namespaceBindings };
}

function findRawSignOutCalls(sourceFile) {
  const { directBindings, namespaceBindings } = collectRawSignOutBindings(sourceFile);
  const calls = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      let isRawSignOut = false;

      if (ts.isIdentifier(expression) && directBindings.has(expression.text)) {
        isRawSignOut = true;
      } else if (
        ts.isPropertyAccessExpression(expression)
        && expression.name.text === 'signOut'
        && ts.isIdentifier(expression.expression)
        && namespaceBindings.has(expression.expression.text)
      ) {
        isRawSignOut = true;
      }

      if (isRawSignOut) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        calls.push({ line: position.line + 1, column: position.character + 1 });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

if (!fs.existsSync(appRoot)) {
  console.error(`[auth-boundary] Diretório não encontrado: ${appRoot}`);
  process.exit(1);
}

const violations = [];

for (const absolutePath of walkTypeScriptFiles(appRoot)) {
  const relativePath = normalizeRelativePath(absolutePath);
  if (relativePath === canonicalRelativePath) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const call of findRawSignOutCalls(sourceFile)) {
    violations.push(`${relativePath}:${call.line}:${call.column}`);
  }
}

if (violations.length > 0) {
  console.error('[auth-boundary] Firebase Auth signOut fora da fronteira canônica:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '[auth-boundary] Use AuthFacade.logout$()/logout() ou LogoutService. '
      + 'Somente logout.service.ts pode chamar Firebase signOut diretamente.'
  );
  process.exit(1);
}

console.log(
  '[auth-boundary] OK: Firebase signOut permanece exclusivo de LogoutService.'
);
