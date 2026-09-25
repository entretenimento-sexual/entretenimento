// scripts/quality/check-template-style-orphans.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC);
const textFiles = files.filter((file) =>
  /\.(?:ts|html|css|scss|json)$/i.test(file)
);
const referenced = new Set();

function addResolved(fromFile, raw) {
  const clean = String(raw ?? '').trim().split('?')[0].split('#')[0];
  if (!clean || /^(?:https?:|data:|\/\/)/i.test(clean)) return;
  const target = clean.startsWith('/')
    ? path.resolve(ROOT, clean.slice(1))
    : path.resolve(path.dirname(fromFile), clean);
  referenced.add(target);
}

for (const file of textFiles) {
  const source = fs.readFileSync(file, 'utf8');

  // Captura todas as referências locais de template/estilo, inclusive
  // múltiplos itens de styleUrls e @imports em CSS compartilhado.
  for (const match of source.matchAll(
    /['"]([^'"]+\.(?:html|css|scss))['"]/g
  )) {
    addResolved(file, match[1]);
  }
}

const angularJson = path.join(ROOT, 'angular.json');
if (fs.existsSync(angularJson)) {
  const source = fs.readFileSync(angularJson, 'utf8');
  for (const match of source.matchAll(/"([^"]+\.(?:css|scss))"/g)) {
    addResolved(angularJson, match[1]);
  }
}

const candidates = files
  .filter((file) => {
    const normalized = file.split(path.sep).join('/');
    if (normalized.endsWith('/src/index.html')) return false;
    if (/\.spec\.html$/i.test(normalized)) return false;
    return /\.(?:html|css|scss)$/i.test(normalized);
  })
  .filter((file) => !referenced.has(path.resolve(file)))
  .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
  .sort();

if (candidates.length) {
  console.error('[template-style-orphans] Arquivos sem referência estática:');
  for (const file of candidates) console.error(` - ${file}`);
  process.exit(1);
}

console.log('[template-style-orphans] OK: nenhum template/estilo local órfão.');
