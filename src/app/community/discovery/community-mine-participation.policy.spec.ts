import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_MINE_SEARCH_THRESHOLD,
  filterMineCommunityItems,
  isManagedCommunityRole,
  shouldShowMineCommunitySearch,
} from './community-mine-participation.policy';

const items = [
  {
    name: 'Café e Conversa',
    viewerRole: 'owner' as const,
    notificationsMuted: false,
  },
  {
    name: 'Amizade São Paulo',
    viewerRole: 'admin' as const,
    notificationsMuted: true,
  },
  {
    name: 'Leitura Noturna',
    viewerRole: 'moderator' as const,
    notificationsMuted: false,
  },
  {
    name: 'Música Brasileira',
    viewerRole: 'member' as const,
    notificationsMuted: true,
  },
];

describe('community mine participation policy', () => {
  it('considera owner, admin e moderator como Comunidades administradas', () => {
    expect(isManagedCommunityRole('owner')).toBe(true);
    expect(isManagedCommunityRole('admin')).toBe(true);
    expect(isManagedCommunityRole('moderator')).toBe(true);
    expect(isManagedCommunityRole('member')).toBe(false);
  });

  it('mantém filtros locais independentes sem novas leituras', () => {
    expect(
      filterMineCommunityItems(items, 'managed', '').map((item) => item.name)
    ).toEqual([
      'Café e Conversa',
      'Amizade São Paulo',
      'Leitura Noturna',
    ]);

    expect(
      filterMineCommunityItems(items, 'member', '').map((item) => item.name)
    ).toEqual(['Música Brasileira']);

    expect(
      filterMineCommunityItems(items, 'muted', '').map((item) => item.name)
    ).toEqual(['Amizade São Paulo', 'Música Brasileira']);
  });

  it('busca por nome ignorando caixa e acentuação', () => {
    expect(
      filterMineCommunityItems(items, 'all', 'musica').map((item) => item.name)
    ).toEqual(['Música Brasileira']);

    expect(
      filterMineCommunityItems(items, 'all', 'cafe').map((item) => item.name)
    ).toEqual(['Café e Conversa']);
  });

  it('só abre busca quando a quantidade carregada justifica ou há consulta ativa', () => {
    expect(
      shouldShowMineCommunitySearch(COMMUNITY_MINE_SEARCH_THRESHOLD - 1, '')
    ).toBe(false);
    expect(
      shouldShowMineCommunitySearch(COMMUNITY_MINE_SEARCH_THRESHOLD, '')
    ).toBe(true);
    expect(shouldShowMineCommunitySearch(1, 'cafe')).toBe(true);
  });
});
