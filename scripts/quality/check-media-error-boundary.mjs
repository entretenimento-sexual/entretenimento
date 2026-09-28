// scripts/quality/check-media-error-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA ERROR BOUNDARY
// -----------------------------------------------------------------------------
// Erro técnico em Media deve terminar em MediaApplicationErrorService.
// ErrorNotificationService permanece disponível apenas para sucesso, info e
// avisos esperados de validação/estado.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const appRoot = path.join(root, 'src', 'app');

const roots = [
  path.join(appRoot, 'core', 'services', 'media'),
  path.join(appRoot, 'core', 'services', 'image-handling'),
  path.join(appRoot, 'media'),
  path.join(appRoot, 'photo-editor', 'photo-editor'),
];

function runtimeTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) return runtimeTypeScriptFiles(absolute);
    if (
      !entry.endsWith('.ts') ||
      entry.endsWith('.spec.ts') ||
      entry.endsWith('.test.ts')
    ) {
      return [];
    }

    return [absolute];
  });
}

const files = roots.flatMap(runtimeTypeScriptFiles);

const violations = [];

for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const source = fs.readFileSync(file, 'utf8');

  const isMediaBoundary = relative.endsWith(
    'src/app/core/services/media/media-application-error.service.ts'
  );

  if (
    /import\s*\{[^}]*\bGlobalErrorHandlerService\b[^}]*\}/m.test(source)
  ) {
    violations.push(`${relative}: GlobalErrorHandlerService direto`);
  }

  if (
    /import\s*\{[^}]*\bApplicationErrorService\b[^}]*\}/m.test(source) &&
    !isMediaBoundary
  ) {
    violations.push(`${relative}: ApplicationErrorService fora da fronteira de Media`);
  }

  if (
    /\.(?:showError|showGenericError)\s*\(/m.test(source) &&
    !isMediaBoundary
  ) {
    violations.push(`${relative}: showError/showGenericError direto`);
  }

  if (/\.handleError\s*\(/m.test(source)) {
    violations.push(`${relative}: handleError legado`);
  }
}

const catalogPath = path.join(
  appRoot,
  'core',
  'services',
  'media',
  'media-error.catalog.ts'
);
const boundaryPath = path.join(
  appRoot,
  'core',
  'services',
  'media',
  'media-application-error.service.ts'
);
const catalog = fs.readFileSync(catalogPath, 'utf8');
const boundary = fs.readFileSync(boundaryPath, 'utf8');

for (const fragment of [
  'MEDIA_ERROR_CODE_MESSAGES',
  'MEDIA_ERROR_CODE_PRESENTATIONS',
  'MEDIA_ERROR_MESSAGES',
  'MEDIA_ERROR_PRESENTATIONS',
  'resolveMediaErrorMessage',
  'resolveMediaErrorPresentation',
]) {
  if (!catalog.includes(fragment)) {
    violations.push(`media-error.catalog.ts: contrato ausente: ${fragment}`);
  }
}

for (const fragment of [
  'codeMessages: MEDIA_ERROR_CODE_MESSAGES',
  'codePresentations: MEDIA_ERROR_CODE_PRESENTATIONS',
  'reasonMessages: MEDIA_ERROR_MESSAGES',
  'reasonPresentations: MEDIA_ERROR_PRESENTATIONS',
  'reasonHint',
]) {
  if (!boundary.includes(fragment)) {
    violations.push(
      `media-application-error.service.ts: integração ausente: ${fragment}`
    );
  }
}

if (violations.length > 0) {
  console.error('[media-error-boundary] Violações encontradas:');
  for (const violation of violations) {
    console.error(' - ' + violation);
  }
  process.exit(1);
}

console.log(
  '[media-error-boundary] OK: erros técnicos usam MediaApplicationErrorService e reason -> mensagem -> presentation é canônico.'
);
