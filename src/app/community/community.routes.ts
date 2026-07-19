// src/app/community/community.routes.ts
import { Routes } from '@angular/router';

export const COMMUNITY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./discovery/community-discovery-page.component').then(
        (module) => module.CommunityDiscoveryPageComponent
      ),
  },
  {
    path: 'locais/novo',
    loadComponent: () =>
      import('./venue-create/venue-community-create-page.component').then(
        (module) => module.VenueCommunityCreatePageComponent
      ),
  },
  {
    path: 'locais',
    data: { sourceType: 'venue' },
    loadComponent: () =>
      import('./discovery/community-discovery-page.component').then(
        (module) => module.CommunityDiscoveryPageComponent
      ),
  },
  {
    path: 'locais/:communityId',
    loadComponent: () =>
      import('./preview/community-preview-page.component').then(
        (module) => module.CommunityPreviewPageComponent
      ),
  },
  {
    path: ':communityId',
    loadComponent: () =>
      import('./preview/community-preview-page.component').then(
        (module) => module.CommunityPreviewPageComponent
      ),
  },
];
