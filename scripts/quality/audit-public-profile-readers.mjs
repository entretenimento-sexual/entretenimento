#!/usr/bin/env node
// Issues #235/#236 — read-only inventory of explicit public_profiles references.
// No Firebase SDK, credentials, HTTP requests, raw document contents or writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_ROOTS = Object.freeze(['functions/src', 'scripts/maintenance']);
const SAFE_EXTENSION = /\.(?:ts|mjs)$/;
const EXCLUDED_FILE = /(?:\.test|\.spec|\.d)\.ts$/;

export function scanSource(text, relativePath) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trimStart();
    // Comments do not prove a repository read; keep only executable-line mentions.
    if (!line.includes('public_profiles') ||
        trimmed.startsWith('//') || trimmed.startsWith('*') ||
        trimmed.startsWith('#')) continue;
    findings.push(Object.freeze({
      file: relativePath,
      line: index + 1,
    }));
  }
  return findings;
}

function walk(dir, base, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Refuse symlink traversal. Dependency/build outputs are never searched.
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, files);
    } else if (entry.isFile() && SAFE_EXTENSION.test(entry.name) &&
               !EXCLUDED_FILE.test(entry.name)) {
      files.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
}

export function inventory(root) {
  const scanned = [];
  for (const rel of SCAN_ROOTS) walk(path.join(root, rel), root, scanned);
  scanned.sort();
  const findings = scanned.flatMap(relative => scanSource(
    fs.readFileSync(path.join(root, relative), 'utf8'), relative
  ));
  const paths = [...new Set(findings.map(x => x.file))].sort();
  return {
    mode: 'STATIC_INVENTORY_READ_ONLY',
    sourceFilesScanned: scanned.length,
    filesWithExplicitReferences: paths.length,
    explicitReferenceLines: findings.length,
    referencedFiles: paths,
    findings,
    caveat: 'Textual inventory only: dynamic paths and semantic authorization require manual review.',
  };
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.some(x => !['--json', '--check-known'].includes(x)) ||
      args.includes('--json') && args.includes('--check-known')) {
    console.error('Usage: node scripts/quality/audit-public-profile-readers.mjs [--json|--check-known]');
    process.exitCode = 2;
  } else {
    const result = inventory(process.cwd());
    if (args.includes('--check-known')) {
      const known = [
        'functions/src/discovery/get-public-profiles-page.handler.ts',
        'functions/src/community/get-profile-public-communities.handler.ts',
        'functions/src/community/search-community-members-page.handler.ts',
        'functions/src/community/sync-community-member-search-index-from-public-profile.trigger.ts',
      ];
      const missing = known.filter(x => !result.referencedFiles.includes(x));
      if (missing.length) {
        console.error('AUDIT_INCOMPLETE_MISSING_EXPECTED_READERS:', missing.join(','));
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify({
          phase: 'ISSUE235_236_BACKEND_READER_INVENTORY', status: 'PASS',
          sourceFilesScanned: result.sourceFilesScanned,
          filesWithExplicitReferences: result.filesWithExplicitReferences,
          explicitReferenceLines: result.explicitReferenceLines,
          knownReaderPathsFound: known.length,
          semanticallyCertified: false,
        }));
      }
    } else if (args.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`READ_ONLY public_profiles inventory: ${result.filesWithExplicitReferences} files / ${result.explicitReferenceLines} explicit reference lines in ${result.sourceFilesScanned} sources.`);
      console.log(result.referencedFiles.join('\n'));
      console.log(result.caveat);
    }
  }
}
