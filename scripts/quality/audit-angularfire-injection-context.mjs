// Report-only lexical inventory. Context classification is a review aid, not
// a runtime proof or an authorization decision. Native firebase/* is excluded.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = join(process.cwd(), 'src', 'app');
const contextMethods = new Set([
  'run', 'defer$', 'deferObservable$', 'deferPromise$', 'runInAngularInjectionContext',
]);

function isContextFactory(node) {
  const call = node.parent;
  if (!ts.isCallExpression(call) || !call.arguments.some(arg => arg === node)) return false;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'runInInjectionContext';
  return ts.isPropertyAccessExpression(callee) && contextMethods.has(callee.name.text);
}

function classify(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) {
      if (ts.isConstructorDeclaration(parent)) return 'construction-review';
      if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
        // DI is synchronous: an async factory can resume after an await.
        const isAsync = parent.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
        if (isContextFactory(parent) && !isAsync) return 'explicit-context';
      }
      return 'review';
    }
    if (ts.isPropertyDeclaration(parent)) return 'construction-review';
  }
  return 'review';
}

function inspect(source) {
  const named = new Map();
  const namespaces = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (!moduleName.startsWith('@angular/fire/')) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, moduleName);
    else for (const element of bindings.elements) {
      if (!element.isTypeOnly) named.set(element.name.text, {
        moduleName, api: element.propertyName?.text ?? element.name.text,
      });
    }
  }
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      let binding;
      if (ts.isIdentifier(expression)) binding = named.get(expression.text);
      else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
        const moduleName = namespaces.get(expression.expression.text);
        if (moduleName) binding = { moduleName, api: expression.name.text };
      }
      if (binding) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        calls.push({ ...binding, line, classification: classify(node) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.isFile() && path.endsWith('.ts') &&
      !/\.(?:spec|test|d)\.ts$/.test(path) ? [path] : [];
  });
}

// Guard the classifier itself: imports/aliases, retry callbacks and await
// boundaries must not accidentally be classified as proven safe.
const fixture = ts.createSourceFile('fixture.ts', [
  "import { docSnapshots as watch } from '@angular/fire/firestore';",
  "import * as auth from '@angular/fire/auth';",
  "import { doc } from 'firebase/firestore';",
  "class C {",
  "  field = watch(ref);",
  "  good() { return ctx.deferObservable$(() => watch(ref)); }",
  "  bad() { return ctx.run(() => defer(() => watch(ref))); }",
  "  late() { return ctx.deferPromise$(async () => { await ready(); return auth.signOut(a); }); }",
  "  native() { return doc(db, 'a'); }",
  "}",
].join('\n'), ts.ScriptTarget.Latest, true);
assert.deepEqual(inspect(fixture).map(call => [call.api, call.classification]), [
  ['docSnapshots', 'construction-review'],
  ['docSnapshots', 'explicit-context'],
  ['docSnapshots', 'review'],
  ['signOut', 'review'],
]);

const sourcePaths = files(root).sort();
const counts = { 'explicit-context': 0, 'construction-review': 0, review: 0 };
let total = 0;
for (const path of sourcePaths) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const call of inspect(source)) {
    counts[call.classification]++;
    total++;
    if (call.classification !== 'explicit-context') {
      console.log(`[angularfire-context] ${call.classification} ${relative(process.cwd(), path)}:${call.line} ${call.moduleName}.${call.api}`);
    }
  }
}
console.log(`[angularfire-context] ${sourcePaths.length} production TS files; ${total} direct AngularFire calls; ${JSON.stringify(counts)}`);
console.log('[angularfire-context] Report only: lexical candidates require manual review; aliases through variables, indirect calls, shadowing and runtime context are not resolved.');
