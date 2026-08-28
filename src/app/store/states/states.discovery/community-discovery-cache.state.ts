// src/app/store/states/states.discovery/community-discovery-cache.state.ts

import type { CommunityDiscoveryListState } from 'src/app/community/discovery/community-discovery-cache.model';

export interface CommunityDiscoveryCacheSlice
  extends CommunityDiscoveryListState {
  /** Última revalidação bem-sucedida da primeira página da consulta. */
  readonly lastLoadedAt: number;
  /** Último acesso ao escopo, usado exclusivamente para retenção LRU. */
  readonly lastAccessedAt: number;
  /** Força revalidação sem perder a idade real usada pelo hard TTL. */
  readonly invalidated: boolean;
}

export interface CommunityDiscoveryCacheState {
  readonly activeViewerUid: string | null;
  readonly byQuery: Readonly<Record<string, CommunityDiscoveryCacheSlice>>;
}

export const initialCommunityDiscoveryCacheState: CommunityDiscoveryCacheState = {
  activeViewerUid: null,
  byQuery: {},
};
