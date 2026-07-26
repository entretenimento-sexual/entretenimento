// src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.ts
// Formulário focado em visibilidade/descoberta.
//
// Objetivo:
// - editar apenas o bloco visibility de PreferenceProfile;
// - manter privacidade básica disponível para toda conta autenticada;
// - limitar modo discreto ao Premium e prioridade ao VIP;
// - emitir somente o payload já tipado.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { PreferenceVisibilitySettings } from '../../models/preference-profile.model';
import { DiscoveryMode } from '../../models/preference.types';
import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';

type DiscoveryModeOption = {
  key: DiscoveryMode;
  label: string;
};

@Component({
  selector: 'app-discovery-visibility-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './discovery-visibility-form.component.html',
  styleUrl: './discovery-visibility-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryVisibilityFormComponent {
  readonly visibility = input<PreferenceVisibilitySettings | null>(null);
  readonly capabilities = input<PreferencesCapabilitySnapshot | null>(null);
  readonly saving = input<boolean>(false);

  readonly saveVisibility = output<PreferenceVisibilitySettings>();

  readonly discoveryModeOptions: DiscoveryModeOption[] = [
    { key: 'standard', label: 'Padrão' },
    { key: 'discreet', label: 'Discreto' },
    { key: 'priority', label: 'Prioritário' },
  ];

  private readonly fb = new FormBuilder();

  readonly form = this.fb.nonNullable.group({
    showPreferenceBadges: true,
    showIntentPublicly: false,
    discoveryMode: this.fb.nonNullable.control<DiscoveryMode>('standard'),
  });

  readonly canEdit = computed(
    () => this.capabilities()?.canEditCorePreferences ?? false
  );

  readonly canUseDiscreetMode = computed(
    () => this.capabilities()?.canUseDiscreetMode ?? false
  );

  readonly canUsePriorityVisibility = computed(
    () => this.capabilities()?.canUsePriorityVisibility ?? false
  );

  constructor() {
    effect(() => {
      const visibility = this.visibility();
      if (!visibility) return;

      this.form.patchValue(
        {
          showPreferenceBadges: visibility.showPreferenceBadges,
          showIntentPublicly: visibility.showIntentPublicly,
          discoveryMode: visibility.discoveryMode,
        },
        { emitEvent: false }
      );
    });

    effect(() => {
      if (!this.canEdit()) {
        this.form.disable({ emitEvent: false });
        return;
      }

      this.form.enable({ emitEvent: false });

      const currentMode = this.form.controls.discoveryMode.value;

      if (currentMode === 'discreet' && !this.canUseDiscreetMode()) {
        this.form.controls.discoveryMode.setValue('standard', {
          emitEvent: false,
        });
      }

      if (currentMode === 'priority' && !this.canUsePriorityVisibility()) {
        this.form.controls.discoveryMode.setValue('standard', {
          emitEvent: false,
        });
      }
    });
  }

  submit(): void {
    if (!this.canEdit() || this.saving()) return;

    const raw = this.form.getRawValue();

    this.saveVisibility.emit({
      showPreferenceBadges: raw.showPreferenceBadges,
      showIntentPublicly: raw.showIntentPublicly,
      discoveryMode: this.normalizeMode(raw.discoveryMode),
    });
  }

  isModeAvailable(mode: DiscoveryMode): boolean {
    if (mode === 'discreet') return this.canUseDiscreetMode();
    if (mode === 'priority') return this.canUsePriorityVisibility();
    return true;
  }

  modeRequirement(mode: DiscoveryMode): string {
    if (mode === 'discreet' && !this.canUseDiscreetMode()) {
      return ' — Premium';
    }

    if (mode === 'priority' && !this.canUsePriorityVisibility()) {
      return ' — VIP';
    }

    return '';
  }

  private normalizeMode(mode: DiscoveryMode): DiscoveryMode {
    if (mode === 'priority' && !this.canUsePriorityVisibility()) {
      return 'standard';
    }

    if (mode === 'discreet' && !this.canUseDiscreetMode()) {
      return 'standard';
    }

    return mode;
  }
}
