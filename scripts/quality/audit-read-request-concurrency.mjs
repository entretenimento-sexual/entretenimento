// Report-only inventory: lexical signals are not measured duplicate requests.
// Keep mutations, invalidation paths, signed access and distinct queries separate.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = join(process.cwd(), 'src', 'app');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) :
      path.endsWith('.ts') && !/\.(spec|test|d)\.ts$/.test(path) ? [path] : [];
  });
}

const markers = new Set(['httpsCallable', 'onSnapshot', 'docSnapshots', 'collectionSnapshots',
  'docData', 'collectionData', 'timer', 'interval', 'shareReplay', 'SessionReadInFlight']);
const totals = Object.fromEntries([...markers].map(marker => [marker, 0]));
const endpoints = new Map();
const paths = files(root).sort();
for (const path of paths) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const aliases = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/^(?:@angular\/fire\/|firebase\/|rxjs(?:\/|$))/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) aliases.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  const counts = {};
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        const marker = aliases.get(expression.text) ?? expression.text;
        if (markers.has(marker)) {
          totals[marker]++;
          counts[marker] = (counts[marker] ?? 0) + 1;
          if (marker === 'httpsCallable') {
            const endpoint = node.arguments?.[1];
            if (endpoint && ts.isStringLiteral(endpoint)) {
              const row = relative(process.cwd(), path) + ':' +
                (source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
              const uses = endpoints.get(endpoint.text) ?? [];
              uses.push(row);
              endpoints.set(endpoint.text, uses);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (Object.keys(counts).length) console.log('[request-concurrency] ' + relative(process.cwd(), path) + ' ' + JSON.stringify(counts));
}
for (const [endpoint, uses] of [...endpoints].sort(([a], [b]) => a.localeCompare(b))) {
  if (uses.length > 1) console.log('[request-concurrency] repeated endpoint definition: ' + endpoint + ' ' + JSON.stringify(uses));
}
console.log('[request-concurrency] ' + paths.length + ' production TS files; ' + JSON.stringify(totals));
console.log('[request-concurrency] Report only: definitions, timers and subscriptions are review candidates, not evidence of redundant network requests.');
