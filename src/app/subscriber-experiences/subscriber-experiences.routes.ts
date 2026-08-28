// src/app/subscriber-experiences/subscriber-experiences.routes.ts
import { Routes } from '@angular/router';

export const SUBSCRIBER_EXPERIENCES_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'conexoes',
    pathMatch: 'full',
  },
  {
    path: 'conexoes',
    loadComponent: () =>
      import(
        './exclusive-connections/exclusive-connections-page.component'
      ).then((component) => component.ExclusiveConnectionsPageComponent),
  },
];
