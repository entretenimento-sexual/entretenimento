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
    path: ':communityId',
    loadComponent: () =>
      import('./preview/community-preview-page.component').then(
        (module) => module.CommunityPreviewPageComponent
      ),
  },
];
