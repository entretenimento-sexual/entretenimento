// src/app/community/venue.routes.ts
// -----------------------------------------------------------------------------
// ROTAS CANÔNICAS DE LOCAL
// -----------------------------------------------------------------------------
// Local é um lugar físico ou estabelecimento real. A implementação reutiliza
// componentes sociais existentes, mas a identidade apresentada ao usuário é de
// Local, nunca de Comunidade ou Sala.
// -----------------------------------------------------------------------------

import { Routes } from '@angular/router';

export const VENUE_ROUTES: Routes = [
  {
    path: '',
    data: { sourceType: 'venue' },
    loadComponent: () =>
      import('./discovery/community-discovery-page.component').then(
        (module) => module.CommunityDiscoveryPageComponent
      ),
  },
  {
    path: 'novo',
    loadComponent: () =>
      import('./venue-create/venue-community-create-page.component').then(
        (module) => module.VenueCommunityCreatePageComponent
      ),
  },
  {
    path: ':communityId',
    data: { backRoute: '/dashboard/locais' },
    loadComponent: () =>
      import('./preview/community-preview-page.component').then(
        (module) => module.CommunityPreviewPageComponent
      ),
  },
];
