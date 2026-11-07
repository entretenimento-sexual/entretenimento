import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inventory, scanSource } from '../quality/audit-public-profile-readers.mjs';

test('captures explicit references without copying source content', () => {
  assert.deepEqual(scanSource(`// public_profiles comment\nconst x='public_profiles';\n`, 'demo.ts'), [
    { file: 'demo.ts', line: 2 },
  ]);
});

test('inventory scans only source trees, excludes tests and never changes files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue235236-audit-'));
  try {
    for (const rel of ['functions/src/demo.ts', 'functions/src/demo.test.ts',
                       'functions/lib/generated.ts', 'scripts/maintenance/clean.mjs']) {
      const dest = path.join(root, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, rel.endsWith('demo.ts') || rel.endsWith('clean.mjs')
        ? "db.collection('public_profiles').get();\n"
        : "db.collection('public_profiles');\n", 'utf8');
    }
    const before = fs.readFileSync(path.join(root, 'functions/src/demo.ts'), 'utf8');
    const report = inventory(root);
    assert.equal(report.filesWithExplicitReferences, 2);
    assert.equal(report.explicitReferenceLines, 2);
    assert.deepEqual(report.referencedFiles, [
      'functions/src/demo.ts', 'scripts/maintenance/clean.mjs',
    ]);
    assert.equal(report.mode, 'STATIC_INVENTORY_READ_ONLY');
    assert.equal(report.findings[0].file.includes('private-user'), false);
    assert.equal(fs.readFileSync(path.join(root, 'functions/src/demo.ts'), 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
