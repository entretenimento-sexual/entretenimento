// src/app/preferences/preferences.routes.ts
// Não esquecer comentários explicativos e ferramentas de debug
// OJETIVO DE REDUZIR A COMPLEXIDADE DA UI
import { Routes } from '@angular/router';

export const PREFERENCES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/preferences-hub/preferences-hub.component').then(
        (m) => m.PreferencesHubComponent
      ),
  },
  {
    path: 'overview',
    loadComponent: () =>
      import('./pages/preferences-home/preferences-home.component').then(
        (m) => m.PreferencesHomeComponent
      ),
  },
  {
    path: 'editar/:uid',
    loadComponent: () =>
      import('./pages/preferences-editor/preferences-editor.component').then(
        (m) => m.PreferencesEditorComponent
      ),
  },
  {
    path: 'match-profile',
    loadComponent: () =>
      import('./pages/match-profile-lab/match-profile-lab.component').then(
        (m) => m.MatchProfileLabComponent
      ),
  },
  {
    path: 'discovery-settings',
    loadComponent: () =>
      import('./pages/discovery-settings/discovery-settings.component').then(
        (m) => m.DiscoverySettingsComponent
      ),
  },
  {
    path: 'compatibility-lab/:targetUid',
    loadComponent: () =>
      import('./pages/compatibility-lab/compatibility-lab.component').then(
        (m) => m.CompatibilityLabComponent
      ),
  },
];