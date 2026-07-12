// src/app/dashboard/discovery/models/discovery-feed-page.model.spec.ts

import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryFeedPageCacheKey,
  buildDiscoveryFeedQueryKey,
  normalizeDiscoveryCursor,
  normalizeDiscoveryPageSize,
  normalizeDiscoveryRequest,
} from './discovery-feed-page.model';

describe('discovery-feed-page.model', () => {
  it('deve limitar o tamanho da página dentro do intervalo seguro', () => {
    expect(normalizeDiscoveryPageSize(1)).toBe(6);
    expect(normalizeDiscoveryPageSize(24)).toBe(24);
    expect(normalizeDiscoveryPageSize(500)).toBe(48);
  });

  it('deve rejeitar consulta sem viewerUid válido', () => {
    expect(normalizeDiscoveryRequest({
      viewerUid: ' ',
      mode: 'all',
      pageSize: 24,
    })).toBeNull();
  });

  it('deve produzir chave distinta por usuário, modo e tamanho', () => {
    const base = buildDiscoveryFeedQueryKey({
      viewerUid: 'viewer-a',
      mode: 'all',
      pageSize: 24,
    });

    expect(buildDiscoveryFeedQueryKey({
      viewerUid: 'viewer-b',
      mode: 'all',
      pageSize: 24,
    })).not.toBe(base);

    expect(buildDiscoveryFeedQueryKey({
      viewerUid: 'viewer-a',
      mode: 'compatible',
      pageSize: 24,
    })).not.toBe(base);

    expect(buildDiscoveryFeedQueryKey({
      viewerUid: 'viewer-a',
      mode: 'all',
      pageSize: 12,
    })).not.toBe(base);
  });

  it('deve usar prefixo removido pela limpeza sensível de logout', () => {
    const key = buildDiscoveryFeedQueryKey({
      viewerUid: 'viewer-a',
      mode: 'all',
      pageSize: 24,
    });

    expect(key.startsWith('discovery:public_profiles:uids:')).toBe(true);
  });

  it('deve diferenciar primeira página de páginas com cursor', () => {
    const request = {
      viewerUid: 'viewer-a',
      mode: 'all' as const,
      pageSize: 24,
    };

    const first = buildDiscoveryFeedPageCacheKey(request, null);
    const next = buildDiscoveryFeedPageCacheKey(request, {
      updatedAtMs: 1_700_000_000_000,
      uid: 'profile-z',
    });

    expect(first).not.toBe(next);
    expect(first.endsWith('cursor=first')).toBe(true);
  });

  it('deve manter cursor serializável em epoch e uid', () => {
    expect(normalizeDiscoveryCursor({
      updatedAtMs: 1_700_000_000_000.9,
      uid: 'profile-a',
    })).toEqual({
      updatedAtMs: 1_700_000_000_000,
      uid: 'profile-a',
    });
  });
});
