import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const sourceDirectory = path.resolve(__dirname, '../../src/community');

function readSource(fileName: string): string {
  return readFileSync(path.join(sourceDirectory, fileName), 'utf8');
}

describe('Community admission user-index atomicity', () => {
  it('mantém os três admission paths ligados à projeção transacional', () => {
    for (const fileName of [
      'request-community-membership.handler.ts',
      'community-membership-management.handler.ts',
      'respond-community-invite.handler.ts',
    ]) {
      const source = readSource(fileName);

      assert.equal(
        source.includes('syncCommunityUserIndexInTransaction'),
        true,
        `${fileName}: admission path deve sincronizar community_user_index na transação.`
      );
    }
  });

  it('mantém o trigger como reconciliação adicional do índice', () => {
    const source = readSource('sync-community-user-index.trigger.ts');

    assert.equal(
      source.includes('buildCommunityUserIndexProjection'),
      true
    );
    assert.equal(
      source.includes("collection('community_user_index')"),
      true
    );
  });
});
