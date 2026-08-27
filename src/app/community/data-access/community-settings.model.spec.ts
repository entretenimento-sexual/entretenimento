import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityEditableSettings,
  normalizeCommunitySettingsUpdateResult,
} from './community-settings.model';

describe('community settings normalization', () => {
  it('normaliza configurações editoriais completas', () => {
    expect(normalizeCommunityEditableSettings({
      name: ' Comunidade Segura ',
      description: ' Pessoas com interesses em comum. ',
      rules: ' Respeite todos.\r\n Preserve a privacidade. ',
      joinPolicy: 'invite_only',
      accessTier: 'vip',
      membersCanInvite: true,
      memberLimit: 250,
      tagIds: ['intent:friendship', 'practice:bdsm'],
    })).toEqual({
      name: 'Comunidade Segura',
      description: 'Pessoas com interesses em comum.',
      rules: 'Respeite todos.\nPreserve a privacidade.',
      joinPolicy: 'invite_only',
      membersCanInvite: true,
      memberLimit: 250,
      tagIds: ['intent:friendship', 'practice:bdsm'],
    });
  });

  it('falha fechado para política, regra ou tags malformadas', () => {
    const base = {
      name: 'Comunidade Segura',
      description: null,
      rules: 'Respeite todos os participantes.',
      joinPolicy: 'approval',
      membersCanInvite: false,
      memberLimit: 25,
      tagIds: ['intent:friendship'],
    };

    expect(normalizeCommunityEditableSettings({
      ...base,
      joinPolicy: 'closed',
    })).toBeNull();
    expect(normalizeCommunityEditableSettings({
      ...base,
      rules: 'curta',
    })).toBeNull();
    expect(normalizeCommunityEditableSettings({
      ...base,
      tagIds: [],
    })).toBeNull();
  });

  it('normaliza resposta idempotente e remove campos de auditoria inválidos', () => {
    expect(normalizeCommunitySettingsUpdateResult({
      communityId: 'community-1',
      updated: true,
      changedFields: ['name', 'joinPolicy', '../unsafe', 'name'],
      generatedAt: 100,
    })).toEqual({
      communityId: 'community-1',
      updated: true,
      changedFields: ['name', 'joinPolicy'],
      generatedAt: 100,
    });

    expect(normalizeCommunitySettingsUpdateResult({
      communityId: '../unsafe',
      changedFields: [],
      generatedAt: 100,
    })).toBeNull();
  });
});
