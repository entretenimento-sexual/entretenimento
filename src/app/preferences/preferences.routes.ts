// src/app/preferences/preferences.routes.ts
// Não esquecer comentários explicativos e ferramentas de debug
// OBJETIVO DE REDUZIR A COMPLEXIDADE DA UI
import { Routes } from '@angular/router';

import { preferencesUnsavedChangesGuard } from './guards/preferences-unsaved-changes.guard';

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
    // O editor é exclusivamente da conta autenticada. O UID não faz parte da
    // URL canônica para evitar links obsoletos, enumeração e divergência de sessão.
    path: 'editar',
    canDeactivate: [preferencesUnsavedChangesGuard],
    loadComponent: () =>
      import('./pages/preferences-editor/preferences-editor.component').then(
        (m) => m.PreferencesEditorComponent
      ),
  },
  {
    // Compatibilidade com favoritos e históricos antigos. O parâmetro é
    // deliberadamente descartado antes da criação do componente.
    path: 'editar/:uid',
    redirectTo: 'editar',
    pathMatch: 'full',
  },
  {
    path: 'notificacoes',
    loadComponent: () =>
      import('./pages/notification-settings/notification-settings.component').then(
        (m) => m.NotificationSettingsComponent
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
