// scripts/quality/check-friendship-authority-boundary.mjs
import fs from 'node:fs';
import path from 'node:path';

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

const forbiddenWrites = [
  'addDoc',
  'setDoc',
  'updateDoc',
  'deleteDoc',
  'writeBatch',
  'runTransaction',
];

const violations = [];

for (const file of walk(DOMAIN)) {
  if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
  const source = fs.readFileSync(file, 'utf8');

  for (const symbol of forbiddenWrites) {
    const pattern = new RegExp(`\\b${symbol}\\b`);
    if (pattern.test(source)) {
      violations.push(
        `${path.relative(ROOT, file).split(path.sep).join('/')}: ${symbol}`
      );
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
