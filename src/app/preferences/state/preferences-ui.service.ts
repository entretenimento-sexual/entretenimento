// src/app/preferences/state/preferences-ui.service.ts
// Serviço local de estado do domínio novo de preferências.
//
// Estratégia:
// - usar signals para estado efêmero/local do domínio
// - não competir com NgRx global
// - permitir evolução incremental
//
// Casos de uso:
// - lembrar última tela ativa do domínio
// - lembrar último uid editado
// - lembrar último targetUid do laboratório de compatibilidade
// - controlar painéis avançados de forma local
import { Injectable, computed, signal } from '@angular/core';

import {
  PreferencesDomainView,
  PreferencesUiState,
  initialPreferencesUiState,
} from './preferences-ui.state';
import {
  selectPreferencesActiveView,
  selectPreferencesHasCompatibilityContext,
  selectPreferencesHasEditorContext,
  selectPreferencesIsDomainLoading,
  selectPreferencesLastCompatibilityTargetUid,
  selectPreferencesLastEditorUid,
  selectPreferencesLastVisitedAt,
  selectPreferencesShowAdvancedPanels,
} from './preferences-ui.selectors';

@Injectable({ providedIn: 'root' })
export class PreferencesUiService {
  private readonly state = signal<PreferencesUiState>(initialPreferencesUiState);

  // ---------------------------------------------------------------------------
  // Read-only selectors via computed
  // ---------------------------------------------------------------------------
  readonly state$ = computed(() => this.state());

  readonly activeView = computed(() =>
    selectPreferencesActiveView(this.state())
  );

  readonly isDomainLoading = computed(() =>
    selectPreferencesIsDomainLoading(this.state())
  );

  readonly showAdvancedPanels = computed(() =>
    selectPreferencesShowAdvancedPanels(this.state())
  );

  readonly lastEditorUid = computed(() =>
    selectPreferencesLastEditorUid(this.state())
  );

  readonly lastCompatibilityTargetUid = computed(() =>
    selectPreferencesLastCompatibilityTargetUid(this.state())
  );

  readonly lastVisitedAt = computed(() =>
    selectPreferencesLastVisitedAt(this.state())
  );

  readonly hasEditorContext = computed(() =>
    selectPreferencesHasEditorContext(this.state())
  );

  readonly hasCompatibilityContext = computed(() =>
    selectPreferencesHasCompatibilityContext(this.state())
  );

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  setActiveView(view: PreferencesDomainView): void {
    this.patchState({
      activeView: view,
      lastVisitedAt: Date.now(),
    });
  }

  setDomainLoading(isLoading: boolean): void {
    this.patchState({
      isDomainLoading: !!isLoading,
    });
  }

  setLastEditorUid(uid: string | null): void {
    this.patchState({
      lastEditorUid: this.normalizeNullable(uid),
      lastVisitedAt: Date.now(),
    });
  }

  setLastCompatibilityTargetUid(uid: string | null): void {
    this.patchState({
      lastCompatibilityTargetUid: this.normalizeNullable(uid),
      lastVisitedAt: Date.now(),
    });
  }

  setShowAdvancedPanels(show: boolean): void {
    this.patchState({
      showAdvancedPanels: !!show,
    });
  }

  toggleAdvancedPanels(): void {
    this.patchState({
      showAdvancedPanels: !this.state().showAdvancedPanels,
    });
  }

  resetUiState(): void {
    this.state.set(initialPreferencesUiState);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------
  private patchState(patch: Partial<PreferencesUiState>): void {
    this.state.update((current) => ({
      ...current,
      ...patch,
    }));
  }

  private normalizeNullable(value: string | null | undefined): string | null {
    const normalized = (value ?? '').trim();
    return normalized || null;
  }
}