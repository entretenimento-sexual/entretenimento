// src/app/preferences/state/preferences-ui.selectors.ts
// Selectors puros do estado local do domínio de preferências.
// Não dependem de Angular nem de store específico.
// Isso facilita teste, reuse e futura migração.
import { PreferencesUiState } from './preferences-ui.state';

export const selectPreferencesActiveView = (state: PreferencesUiState) => state.activeView;

export const selectPreferencesIsDomainLoading = (state: PreferencesUiState) =>
  state.isDomainLoading;

export const selectPreferencesShowAdvancedPanels = (state: PreferencesUiState) =>
  state.showAdvancedPanels;

export const selectPreferencesLastEditorUid = (state: PreferencesUiState) =>
  state.lastEditorUid;

export const selectPreferencesLastCompatibilityTargetUid = (state: PreferencesUiState) =>
  state.lastCompatibilityTargetUid;

export const selectPreferencesLastVisitedAt = (state: PreferencesUiState) =>
  state.lastVisitedAt;

export const selectPreferencesHasEditorContext = (state: PreferencesUiState) =>
  !!state.lastEditorUid;

export const selectPreferencesHasCompatibilityContext = (state: PreferencesUiState) =>
  !!state.lastCompatibilityTargetUid;