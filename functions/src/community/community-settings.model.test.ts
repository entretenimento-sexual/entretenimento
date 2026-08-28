import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeUpdateCommunitySettingsRequest,
  resolveCommunitySettingsChangedFields,
  sanitizeCommunityEditableSettings,
} from './community-settings.model';

const VALID_REQUEST_ID = '8d7fb4a1-91e5-4dbf-9cc7-42fd4d77f771';

test('normaliza edição completa e deriva slug sem aceitar campos autoritativos', () => {
  const result = normalizeUpdateCommunitySettingsRequest({
    requestId: VALID_REQUEST_ID,
    communityId: 'community-1',
    name: '  Conexões Áureas  ',
    description: '  Pessoas com interesses em comum. ',
    rules: ' Respeito é obrigatório.\r\nNão exponha outros membros. ',
    joinPolicy: 'invite_only',
    accessTier: 'premium',
    membersCanInvite: true,
    memberLimit: 250,
    tagIds: ['practice:bdsm', 'intent:friendship', 'practice:bdsm'],
    rankScore: 999,
    ownerUid: 'outro-usuario',
  } as Record<string, unknown>);

  assert.deepEqual(result, {
    requestId: VALID_REQUEST_ID,
    communityId: 'community-1',
    name: 'Conexões Áureas',
    slug: 'conexoes-aureas',
    description: 'Pessoas com interesses em comum.',
    rules: 'Respeito é obrigatório.\nNão exponha outros membros.',
    joinPolicy: 'invite_only',
    accessTier: 'all',
    membersCanInvite: true,
    memberLimit: 250,
    tagIds: ['intent:friendship', 'practice:bdsm'],
  });
  assert.equal('rankScore' in (result ?? {}), false);
  assert.equal('ownerUid' in (result ?? {}), false);
});

test('rejeita IDs, conteúdo, políticas e tags inválidos', () => {
  const base = {
    requestId: VALID_REQUEST_ID,
    communityId: 'community-1',
    name: 'Comunidade Segura',
    rules: 'Respeite todos os participantes.',
    joinPolicy: 'approval',
    accessTier: 'all',
    membersCanInvite: false,
    memberLimit: 25,
    tagIds: ['intent:friendship'],
  };

  for (const invalid of [
    { ...base, requestId: 'placeholder' },
    { ...base, communityId: '../unsafe' },
    { ...base, name: 'A' },
    { ...base, rules: 'curta' },
    { ...base, joinPolicy: 'closed' },
    { ...base, membersCanInvite: 'true' },
    { ...base, tagIds: [] },
  ]) {
    assert.equal(normalizeUpdateCommunitySettingsRequest(invalid), null);
  }
});

test('sanitiza somente configurações canônicas coerentes', () => {
  const settings = sanitizeCommunityEditableSettings({
    name: 'Comunidade Segura',
    description: '',
    rules: 'Respeite todos os participantes.',
    tagIds: ['intent:friendship'],
    access: {
      join: 'open',
      contentAccess: {
        requiresActiveSubscription: true,
        minimumRole: 'vip',
      },
      invites: { membersCanInvite: true },
    },
  });

  assert.deepEqual(settings, {
    name: 'Comunidade Segura',
    description: null,
    rules: 'Respeite todos os participantes.',
    joinPolicy: 'open',
    accessTier: 'all',
    membersCanInvite: true,
    memberLimit: 25,
    tagIds: ['intent:friendship'],
  });

  assert.equal(
    sanitizeCommunityEditableSettings({
      name: 'Comunidade Segura',
      rules: 'Respeite todos os participantes.',
      tagIds: ['intent:friendship'],
      access: {
        join: 'closed',
      },
    }),
    null
  );
});

test('lista apenas campos realmente alterados sem incluir conteúdo sensível', () => {
  const current = {
    name: 'Comunidade Segura',
    description: null,
    rules: 'Respeite todos os participantes.',
    joinPolicy: 'approval' as const,
    accessTier: 'all' as const,
    membersCanInvite: false,
    memberLimit: 25 as const,
    tagIds: ['intent:friendship'],
  };
  const changedFields = resolveCommunitySettingsChangedFields(current, {
    ...current,
    rules: 'Respeite todos e preserve a privacidade.',
    joinPolicy: 'invite_only',
    membersCanInvite: true,
  });

  assert.deepEqual(changedFields, [
    'rules',
    'joinPolicy',
    'membersCanInvite',
  ]);
  assert.equal(changedFields.includes(current.rules), false);
});
