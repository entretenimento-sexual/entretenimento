// scripts/quality/check-friendship-authority-boundary.mjs
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const DOMAIN = path.join(
  ROOT,
  'src/app/core/services/interactions/friendship'
);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const forbiddenWrites = new Set([
  'addDoc',
  'setDoc',
  'updateDoc',
  'deleteDoc',
  'writeBatch',
  'runTransaction',
]);

const violations = [];

for (const file of walk(DOMAIN)) {
  if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;

  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@angular/fire/firestore'
    ) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (forbiddenWrites.has(importedName)) {
        violations.push(
          `${path.relative(ROOT, file).split(path.sep).join('/')}: ${importedName}`
        );
      }
    }
  }
}

if (violations.length) {
  console.error(
    '[friendship-authority] Writes Firestore sensíveis reapareceram no cliente:'
  );
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log(
  '[friendship-authority] OK: lifecycle de amizade permanece backend-only; cliente mantém leitura e callables.'
);
