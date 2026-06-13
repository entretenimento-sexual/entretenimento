//src\app\explore\explore.routes.ts
import { Routes } from '@angular/router';

export const EXPLORE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/social-explore-page/social-explore-page.component').then(
        (m) => m.SocialExplorePageComponent
      ),
  },
];
