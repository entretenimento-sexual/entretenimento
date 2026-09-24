// src/app/community/presentation/community-social-space.adapter.spec.ts
import { describe, expect, it } from 'vitest';

import {
  getCommunitySocialSpaceAdapter,
  normalizeCommunitySocialSpaceSourceType,
} from './community-social-space.adapter';

describe('Community social-space adapter', () => {
  it('mantém Community e Venue como produtos distintos sobre o mesmo kernel', () => {
    const community = getCommunitySocialSpaceAdapter('community');
    const venue = getCommunitySocialSpaceAdapter('venue');

    expect(community.definition.kind).toBe('community');
    expect(community.capabilities).toMatchObject({
      topics: true,
      memberDirectory: true,
      rules: true,
      managedLifecycle: true,
      capacityManagement: true,
      interestDiscovery: true,
      personalMembershipHub: true,
      publicLocation: false,
    });

    expect(venue.definition.kind).toBe('venue');
    expect(venue.capabilities).toMatchObject({
      topics: false,
      memberDirectory: false,
      rules: false,
      managedLifecycle: false,
      capacityManagement: false,
      interestDiscovery: false,
      personalMembershipHub: false,
      publicLocation: true,
    });
  });

  it('centraliza navegação sem misturar as rotas dos produtos', () => {
    const community = getCommunitySocialSpaceAdapter('community');
    const venue = getCommunitySocialSpaceAdapter('venue');

    expect(community.discovery.detailsRoute('abc', 'explore')).toEqual([
      '/dashboard/comunidades',
      'abc',
    ]);
    expect(community.discovery.detailsRoute('abc', 'mine')).toEqual([
      '/dashboard/comunidades/minhas',
      'abc',
    ]);
    expect(
      community.discovery.returnTarget('explore', 'amizades')
    ).toBe('/dashboard/comunidades?interesse=amizades');
    expect(venue.discovery.detailsRoute('abc', 'explore')).toEqual([
      '/dashboard/locais',
      'abc',
    ]);
    expect(venue.discovery.returnTarget('explore', 'ignorado')).toBe(
      '/dashboard/locais'
    );
  });

  it('centraliza copy de participação e feed', () => {
    const community = getCommunitySocialSpaceAdapter('community');
    const venue = getCommunitySocialSpaceAdapter('venue');

    expect(community.membership.actionLabel('open')).toBe('Participar');
    expect(venue.membership.actionLabel('open')).toBe('Seguir');
    expect(community.membership.joinLabel('approval')).toBe(
      'Entrada por aprovação'
    );
    expect(venue.membership.joinLabel('approval')).toBe(
      'Acesso por aprovação'
    );
    expect(community.feed('feed').sectionLabel).toBe('Mural');
    expect(venue.feed('feed').sectionLabel).toBe('Novidades');
    expect(community.feed('photos').ariaLabel).toBe('Fotos da Comunidade');
    expect(venue.feed('photos').ariaLabel).toBe('Fotos do Local');
  });

  it('normaliza apenas o discriminante público suportado', () => {
    expect(normalizeCommunitySocialSpaceSourceType('venue')).toBe('venue');
    expect(normalizeCommunitySocialSpaceSourceType('community')).toBe(
      'community'
    );
    expect(normalizeCommunitySocialSpaceSourceType('official_space')).toBe(
      'community'
    );
    expect(normalizeCommunitySocialSpaceSourceType('room')).toBe('community');
  });
});
