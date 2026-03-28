// src/app/preferences/state/preferences-ui.state.ts
// Estado local do domínio novo de preferências.
//
// Objetivo:
// - centralizar estado efêmero de navegação/UX do domínio preferences
// - NÃO substituir o Auth/NgRx global
// - servir como contrato claro para a camada local em signal state

export type PreferencesDomainView =
  | 'hub'
  | 'overview'
  | 'editor'
  | 'discovery_settings'
  | 'match_profile_lab'
  | 'compatibility_lab';

export interface PreferencesUiState {
  activeView: PreferencesDomainView;

  isDomainLoading: boolean;
  showAdvancedPanels: boolean;

  lastEditorUid: string | null;
  lastCompatibilityTargetUid: string | null;

  lastVisitedAt: number | null;
}

export const initialPreferencesUiState: PreferencesUiState = {
  activeView: 'hub',
  isDomainLoading: false,
  showAdvancedPanels: true,
  lastEditorUid: null,
  lastCompatibilityTargetUid: null,
  lastVisitedAt: null,
};