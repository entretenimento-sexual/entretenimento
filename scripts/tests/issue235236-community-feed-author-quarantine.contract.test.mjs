import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const author = () => source('functions/src/community/community-public-author.model.ts');
const workflow = () => source('.github/workflows/discovery-legacy-recovery-transaction-guard.yml');

test('adaptador preserva metodo publico mas recusa perfil contaminado e fallback residual', () => {
  const code = author();
  assert.match(code, /import \{ hasLegacyPrivateDiscoveryFields \} from '\.\.\/discovery\/legacy-public-profile-preservation\.policy';/);
  assert.match(code, /export function buildCommunityPublicAuthor\(/);
  assert.match(code, /if \(hasLegacyPrivateDiscoveryFields\(rawProfile\)\)/);
  assert.match(code, /buildPublicUserIdentity\(null, \{\s*label: 'Participante',\s*avatarUrl: null,/);
  assert.match(code, /return buildPublicUserIdentity\(rawProfile, fallback\)/);
  assert.doesNotMatch(code, /export const buildCommunityPublicAuthor = buildPublicUserIdentity/);
});

test('mural e comentarios usam adaptador em vez de projetar diretamente identidade crua', () => {
  const paths = [
    'functions/src/community/community-feed-read.service.ts',
    'functions/src/community/get-community-feed-comments-page.handler.ts',
    'functions/src/community/get-community-feed-comment-replies-page.handler.ts',
  ];
  for (const path of paths) {
    const code = source(path);
    assert.match(code, /buildCommunityPublicAuthor\(/, path);
    assert.match(code, /publicProfilesByUid\.get\(/, path);
    assert.doesNotMatch(code, /buildPublicUserIdentity\(/, path);
  }
  const mural = source(paths[0]);
  assert.match(mural, /targetAuthor = buildCommunityPublicAuthor\(/);
  assert.match(mural, /authorLabel: targetAuthor\.label/);
  const comments = source(paths[1]);
  assert.match(comments, /targetAuthor = target\s*\? buildCommunityPublicAuthor\(/);
  assert.match(comments, /authorLabel: targetAuthor\?\.label/);
});

test('CI cobre politica compilada e contrato source em Windows e Ubuntu', () => {
  const code = workflow();
  assert.match(code, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(code, /node --test scripts\/tests\/issue235236-community-feed-author-quarantine\.contract\.test\.mjs/);
  assert.match(code, /working-directory: functions[\s\S]*node --test lib\/community\/community-public-author\.model\.test\.js/);
  for (const path of [
    'functions/src/community/community-public-author.model.ts',
    'functions/src/community/community-public-author.model.test.ts',
    'docs/operations/issue235236-community-feed-author-quarantine-stage3.md',
    'scripts/tests/issue235236-community-feed-author-quarantine.contract.test.mjs',
  ]) {
    assert.ok(code.includes(`'${path}'`), `workflow nao acompanha ${path}`);
  }
});
