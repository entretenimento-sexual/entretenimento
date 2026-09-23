// scripts/quality/check-community-error-presentation-boundary.mjs
// -----------------------------------------------------------------------------
// COMMUNITY ERROR PRESENTATION ARCHITECTURE BOUNDARY
// -----------------------------------------------------------------------------
// A apresentação de erros de Comunidades pertence ao catálogo canônico.
// Callers podem selecionar somente contextos semânticos previamente declarados;
// não podem recriar surface/severity/modal/snackbar nem mapas de presentation.
// -----------------------------------------------------------------------------

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const COMMUNITY_ROOT = path.join(ROOT, 'src', 'app', 'community');
const ADMIN_ROOT = path.join(ROOT, 'src', 'app', 'admin-dashboard');
const CANONICAL_CATALOG = path.normalize(
  'src/app/community/presentation/community-error.catalog.ts'
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function rel(file) {
  return path.normalize(path.relative(ROOT, file));
}

function isTestFile(file) {
  return /\.(?:spec|test)\.ts$/i.test(file);
}

function isCommunityAdminSurface(file, source) {
  return file.startsWith(path.normalize('src/app/admin-dashboard/'))
    && /\bfeature\s*:\s*['"]community['"]/.test(source);
}

function lineFor(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

const forbidden = [
  {
    label: 'catálogo paralelo de presentation de Comunidades',
    pattern: /community-error\.presentations/g,
  },
  {
    label: 'import direto do modelo de presentation',
    pattern: /application-error-presentation\.model/g,
  },
  {
    label: 'tipo ApplicationErrorPresentation fora do catálogo',
    pattern: /\bApplicationErrorPresentation(?:Map)?\b/g,
  },
  {
    label: 'override manual presentation',
    pattern: /\bpresentation\s*:/g,
  },
  {
    label: 'mapa manual reasonPresentations',
    pattern: /\breasonPresentations\s*:/g,
  },
  {
    label: 'mapa manual codePresentations',
    pattern: /\bcodePresentations\s*:/g,
  },
  {
    label: 'mapa manual recommendedActionPresentations',
    pattern: /\brecommendedActionPresentations\s*:/g,
  },
  {
    label: 'override legado notification',
    pattern: /\bnotification\s*:/g,
    requiresErrorReporter: true,
  },
  {
    label: 'surface de erro composta manualmente',
    pattern: /\bsurface\s*:\s*['"](?:snackbar|modal|inline|page|none)['"]/g,
  },
];

const roots = [COMMUNITY_ROOT, ADMIN_ROOT];
const allFiles = (
  await Promise.all(roots.map((root) => walk(root)))
).flat();

const violations = [];

for (const absolutePath of allFiles) {
  const file = rel(absolutePath);
  if (file === CANONICAL_CATALOG || isTestFile(file)) continue;

  const source = await readFile(absolutePath, 'utf8');
  const communityFile = file.startsWith(path.normalize('src/app/community/'));
  if (!communityFile && !isCommunityAdminSurface(file, source)) continue;

  const errorReporter =
    /\bApplicationErrorService\b/.test(source)
    || /\bapplicationError\.report\s*\(/.test(source);

  for (const rule of forbidden) {
    if (rule.requiresErrorReporter && !errorReporter) continue;
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(source)) !== null) {
      violations.push({
        file,
        line: lineFor(source, match.index),
        label: rule.label,
        match: match[0],
      });
    }
  }

  if (
    /\bcommunityPresentationContext\s*:\s*['"]/.test(source)
  ) {
    const index = source.search(
      /\bcommunityPresentationContext\s*:\s*['"]/
    );
    violations.push({
      file,
      line: lineFor(source, index),
      label: 'contexto de presentation deve usar constante canônica',
      match: source.slice(index, index + 80).split(/\r?\n/)[0],
    });
  }
}

if (violations.length > 0) {
  console.error(
    'Community error presentation boundary violado. '
    + 'Use community-error.catalog.ts e contextos canônicos.\n'
  );
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} `
      + `[${violation.label}] ${violation.match}`
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    'Community error presentation boundary: OK '
    + '(catálogo canônico sem composição manual).'
  );
}
