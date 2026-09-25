import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', 'community', relativePath),
    'utf8'
  );
}

test('busca de membros usa índice somente como locator e revalida autoridade antes de responder', () => {
  const handler = source('search-community-members-page.handler.ts');

  assert.equal(handler.includes('getCommunityViewerContext(actorUid, communityId)'), true);
  assert.equal(handler.includes('!context.activeMembership'), true);
  assert.equal(handler.includes("action: 'member_search'"), true);
  assert.equal(handler.includes(".collection('community_member_search_index')"), true);
  assert.equal(handler.includes('resolveBlockedTargetUids(actorUid, candidateIds)'), true);
  assert.equal(handler.includes(".collection('communities')"), true);
  assert.equal(handler.includes(".collection('members')"), true);
  assert.equal(handler.includes(".collection('public_profiles')"), true);
  assert.equal(handler.includes('buildCommunityMemberSearchIndexProjection({'), true);
  assert.equal(handler.includes("profile['nickname']"), true);

  // O índice nunca deve substituir a revalidação da membership/perfil canônicos.
  const indexRead = handler.indexOf(".collection('community_member_search_index')");
  const membershipRead = handler.indexOf(".collection('members')");
  const projectionRevalidation = handler.lastIndexOf(
    'buildCommunityMemberSearchIndexProjection({'
  );

  assert.ok(indexRead >= 0);
  assert.ok(membershipRead > indexRead);
  assert.ok(projectionRevalidation > membershipRead);
});

test('busca de membros não lê users/{uid} nem projeta identidade privada', () => {
  const handler = source('search-community-members-page.handler.ts');
  const policy = source('community-member-search-index.policy.ts');
  const membershipTrigger = source('sync-community-member-search-index.trigger.ts');
  const profileTrigger = source(
    'sync-community-member-search-index-from-public-profile.trigger.ts'
  );

  for (const implementation of [
    handler,
    policy,
    membershipTrigger,
    profileTrigger,
  ]) {
    assert.equal(
      implementation.includes(".collection('users')"),
      false,
      'busca pública de integrantes não pode depender de users/{uid}'
    );
  }

  assert.equal(policy.includes("profile['nickname']"), true);
  assert.equal(policy.includes("profile['nome']"), false);
  assert.equal(policy.includes("profile['email']"), false);
});

test('sincronizador por membership remove projeção inválida e usa public_profiles', () => {
  const trigger = source('sync-community-member-search-index.trigger.ts');

  assert.equal(
    trigger.includes("document: 'communities/{communityId}/members/{memberId}'"),
    true
  );
  assert.equal(trigger.includes(".collection('public_profiles')"), true);
  assert.equal(trigger.includes('buildCommunityMemberSearchIndexProjection({'), true);
  assert.equal(trigger.includes('await indexRef.delete();'), true);
});

test('mudança de nickname/maioridade pública converge sem varrer todas as comunidades', () => {
  const trigger = source(
    'sync-community-member-search-index-from-public-profile.trigger.ts'
  );

  assert.equal(trigger.includes("document: 'public_profiles/{memberId}'"), true);
  assert.equal(trigger.includes('communityMemberSearchPublicProfileFingerprint'), true);
  assert.equal(trigger.includes(".collection('community_user_index')"), true);
  assert.equal(trigger.includes(".collection('items')"), true);
  assert.equal(trigger.includes('buildCommunityMemberSearchIndexProjection({'), true);
  assert.equal(trigger.includes('writer.delete(indexRef)'), true);
  assert.equal(trigger.includes('writer.set('), true);
  assert.equal(trigger.includes('await writer.close()'), true);
});

test('cursor permanece vinculado ao termo e bloqueio bilateral ocorre antes da resposta', () => {
  const handler = source('search-community-members-page.handler.ts');

  assert.equal(handler.includes('(cursor && cursor.query !== query)'), true);
  assert.equal(
    handler.includes("reason: providedCursor\n              ? 'community_search_cursor_invalid'"),
    true
  );

  const blockResolution = handler.indexOf(
    'resolveBlockedTargetUids(actorUid, candidateIds)'
  );
  const responsePush = handler.indexOf('items.push({');

  assert.ok(blockResolution >= 0);
  assert.ok(responsePush > blockResolution);
});
