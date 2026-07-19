// src/app/community/community.routes.ts
// -----------------------------------------------------------------------------
// ROTAS CANÔNICAS DE COMUNIDADE
// -----------------------------------------------------------------------------
// Comunidade é um grupo permanente de pessoas unidas por interesse, identidade,
// região ou objetivo. Local possui rota própria e Sala permanece em /chat/rooms.
//
// As rotas antigas de Local são preservadas somente como redirecionamentos para
// evitar quebra de favoritos, histórico e links já compartilhados.
// -----------------------------------------------------------------------------

import { Routes } from '@angular/router';

export const COMMUNITY_ROUTES: Routes = [
  {
    path: 'locais/novo',
    redirectTo: '/dashboard/locais/novo',
    pathMatch: 'full',
  },
  {
    path: 'locais/:communityId',
    redirectTo: '/dashboard/locais/:communityId',
    pathMatch: 'full',
  },
  {
    path: 'locais',
    redirectTo: '/dashboard/locais',
    pathMatch: 'full',
  },
  {
    path: '',
    data: { sourceType: 'community' },
    loadComponent: () =>
      import('./discovery/community-discovery-page.component').then(
        (module) => module.CommunityDiscoveryPageComponent
      ),
  },
  {
    path: ':communityId',
    data: { backRoute: '/dashboard/comunidades' },
    loadComponent: () =>
      import('./preview/community-preview-page.component').then(
        (module) => module.CommunityPreviewPageComponent
      ),
  },
];
