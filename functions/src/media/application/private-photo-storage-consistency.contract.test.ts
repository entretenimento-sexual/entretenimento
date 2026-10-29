import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const consistency = readFileSync(resolve(__dirname,
  'private-photo-storage-consistency.service.ts'), 'utf8');
const audit = readFileSync(resolve(__dirname,
  '../../../../scripts/dev/audit-legacy-photo-origins.mjs'), 'utf8');

describe('private photo consistency never deletes an active social publication', () => {
  it('consults social publication before declaring a private original orphaned', () => {
    assert.ok(consistency.includes(
      'const [privatePhotoSnap, publicationSnap] = await Promise.all(['
    ));
    assert.ok(consistency.includes('classifyLegacyPhotoOrigin({'));
    assert.ok(consistency.includes("'published_source_missing'"));
  });
  it('passes onlyIfUnpublished into the transactionally guarded deletion path', () => {
    assert.match(consistency,
      /deleteProfilePhotoResources\([\s\S]*?\{ onlyIfUnpublished: true \}/
    );
  });
  it('local audit is read-only and must not become a deletion script', () => {
    assert.ok(audit.includes('FIRESTORE_EMULATOR_HOST'));
    assert.ok(audit.includes('STORAGE_EMULATOR_HOST'));
    for (const forbidden of [
      '.delete(', '.recursiveDelete(', '.update(', '.set(', '.create(',
      '.save(', '.deleteFiles(', 'exec(', 'spawn(',
    ]) {
      assert.ok(!audit.includes(forbidden),
        `Prohibited mutation in read-only audit: ${forbidden}`);
    }
  });
});
