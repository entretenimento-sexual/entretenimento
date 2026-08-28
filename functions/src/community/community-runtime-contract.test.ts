import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const communitySourceDirectory = path.resolve(
  __dirname,
  '../../src/community'
);
const ON_CALL_ASSIGNMENT_PATTERN = /=\s*onCall\s*(?:<|\()/;
const COMMUNITY_RUNTIME_PATTERN = /isCommunityPreviewRuntimeAvailable\(\)/;

describe('community runtime contract', () => {
  it('mantém toda callable na fronteira de runtime própria de Comunidades', () => {
    const callableFiles = readdirSync(communitySourceDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => ({
        fileName,
        source: readFileSync(
          path.join(communitySourceDirectory, fileName),
          'utf8'
        ),
      }))
      .filter(({ source }) => ON_CALL_ASSIGNMENT_PATTERN.test(source));

    assert.ok(
      callableFiles.length > 0,
      'O contrato deve encontrar ao menos uma callable de Comunidades.'
    );

    for (const { fileName, source } of callableFiles) {
      assert.equal(
        source.includes('isFunctionsEmulatorRuntime'),
        false,
        `${fileName}: callable não deve depender diretamente do guard de Emulator.`
      );
      assert.match(
        source,
        COMMUNITY_RUNTIME_PATTERN,
        `${fileName}: callable deve usar o guard de runtime de Comunidades.`
      );
    }
  });
});
