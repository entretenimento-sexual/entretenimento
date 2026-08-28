// C:\entretenimento\firestore-rules\tools-rules\check-braces.mjs
// -----------------------------------------------------------------------------
// FIRESTORE RULES BRACES CHECK
// -----------------------------------------------------------------------------
//
// Smoke test para balanceamento de chaves nos fragments utilizados pelo build.
//
// Objetivos:
// - verificar exatamente os mesmos fragments do build-firestore-rules.mjs;
// - evitar falso "OK" quando um módulo real não entra no checker;
// - detectar blocos abertos/fechamentos faltando antes da compilação Firebase.
//
// Limite:
// - esta checagem não substitui o parser/compilador oficial das Rules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIRESTORE_RULE_PARTS } from './firestore-rules-parts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..', '..');
const srcDir = path.join(root, 'firestore-rules');

function stripComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function countChar(text, char) {
  return text.split(char).length - 1;
}

let total = 0;
let hasError = false;

for (const part of FIRESTORE_RULE_PARTS) {
  const file = path.join(srcDir, part);

  if (!fs.existsSync(file)) {
    hasError = true;
    console.error(`${part.padEnd(40)} MISSING`);
    continue;
  }

  const body = fs
    .readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n');

  const clean = stripComments(body);
  const opens = countChar(clean, '{');
  const closes = countChar(clean, '}');
  const delta = opens - closes;

  total += delta;

  console.log(
    `${part.padEnd(40)} opens=${String(opens).padStart(3)} ` +
      `closes=${String(closes).padStart(3)} ` +
      `delta=${String(delta).padStart(3)} ` +
      `total=${String(total).padStart(3)}`
  );
}

console.log(`\nFINAL total: ${total} (0 = OK)`);

if (hasError || total !== 0) {
  process.exitCode = 1;
}