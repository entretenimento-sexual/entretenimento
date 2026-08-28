import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const communitySourceDirectory = path.resolve(
  __dirname,
  '../../src/community'
);
const ON_CALL_ASSIGNMENT_PATTERN = /=\s*onCall\s*(?:<|\()/g;
const ENFORCE_APP_CHECK_PATTERN =
  /enforceAppCheck:\s*REQUIRE_COMMUNITY_APP_CHECK/g;
const DEFENSIVE_APP_CHECK_PATTERN =
  /assertCommunityCallableAppCheck\(request\.app\);/g;

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

describe('community-callable-security contract', () => {
  it('protege toda callable de Comunidades com App Check e asserção defensiva', () => {
    const callableFiles = readdirSync(communitySourceDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => {
        const source = readFileSync(
          path.join(communitySourceDirectory, fileName),
          'utf8'
        );

        return {
          fileName,
          source,
          callableCount: countMatches(source, ON_CALL_ASSIGNMENT_PATTERN),
        };
      })
      .filter(({ callableCount }) => callableCount > 0);

    assert.ok(
      callableFiles.length > 0,
      'O contrato deve encontrar ao menos uma callable de Comunidades.'
    );

    for (const { fileName, source, callableCount } of callableFiles) {
      assert.equal(
        countMatches(source, ENFORCE_APP_CHECK_PATTERN),
        callableCount,
        `${fileName}: cada onCall deve habilitar Community App Check.`
      );
      assert.equal(
        countMatches(source, DEFENSIVE_APP_CHECK_PATTERN),
        callableCount,
        `${fileName}: cada onCall deve validar request.app defensivamente.`
      );
    }
  });
});
