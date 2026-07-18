// C:\entretenimento\firestore-rules\tools-rules\build-firestore-rules.mjs
// -----------------------------------------------------------------------------
// FIRESTORE RULES BUILD
// -----------------------------------------------------------------------------
//
// Constrói firestore.rules a partir dos fragments do manifesto canônico.
//
// Decisões:
// - firestore.rules é artefato gerado; não deve ser editado manualmente;
// - fragments sensíveis ficam versionados em firestore-rules/;
// - build e checker usam exatamente a mesma ordem de arquivos;
// - os marcadores por arquivo permanecem no resultado para diagnóstico.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIRESTORE_RULE_PARTS } from './firestore-rules-parts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raiz do projeto: tools-rules -> firestore-rules -> raiz.
const root = path.resolve(__dirname, '..', '..');
const srcDir = path.join(root, 'firestore-rules');
const outFile = path.join(root, 'firestore.rules');

function build() {
  const banner =
    '// AUTO-GENERATED FILE. DO NOT EDIT.\n' +
    '// Source: firestore-rules/*\n' +
    `// Generated at: ${new Date().toISOString()}\n\n`;

  const content = FIRESTORE_RULE_PARTS
    .map((part) => {
      const file = path.join(srcDir, part);

      if (!fs.existsSync(file)) {
        throw new Error(`Missing rules part: ${part}`);
      }

      const body = fs
        .readFileSync(file, 'utf8')
        .replace(/\r\n/g, '\n')
        .trimEnd();

      return `// ===== ${part} =====\n${body}\n`;
    })
    .join('\n');

  const finalRules = banner + content;

  /**
   * Checagem simples de chaves.
   *
   * Não substitui a compilação do Firebase, mas detecta rapidamente fragment
   * ausente ou fechamento estrutural quebrado.
   */
  const opens = (finalRules.match(/{/g) || []).length;
  const closes = (finalRules.match(/}/g) || []).length;

  if (opens !== closes) {
    throw new Error(
      `[rules] Unbalanced braces: opens=${opens}, closes=${closes}. ` +
      'Check fragments/_footer.'
    );
  }

  fs.writeFileSync(outFile, finalRules, 'utf8');

  console.log(`[rules] built -> ${outFile}`);
}

const watch = process.argv.includes('--watch');

build();

if (watch) {
  fs.watch(srcDir, { recursive: true }, () => {
    try {
      build();
    } catch (error) {
      console.error(error);
    }
  });
}