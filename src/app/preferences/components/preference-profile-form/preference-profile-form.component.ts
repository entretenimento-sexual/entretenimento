// src/app/preferences/components/preference-profile-form/preference-profile-form.component.ts
// -----------------------------------------------------------------------------
// FORMULÁRIO DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// Responsabilidade:
// - renderizar preferências essenciais com navegação progressiva;
// - aplicar limitações por assinatura sem esconder recursos de segurança;
// - preservar seleções pagas existentes quando o entitlement não está ativo;
// - emitir o model normalizado para a página/facade salvar.
// -----------------------------------------------------------------------------

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
import { RouterModule } from '@angular/router';

import { PreferenceProfile } from '../../models/preference-profile.model';
import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';
import { createEmptyPreferenceProfile } from '../../utils/preference-normalizers';
import {
  BODY_PREFERENCE_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  GENDER_INTEREST_OPTIONS,
  RELATIONSHIP_INTENT_OPTIONS,
  SEXUAL_PRACTICE_OPTIONS,
  buildPreferenceProfileForm,
  mapFormValueToPreferenceProfile,
  mapPreferenceProfileToFormValue,
} from '../../utils/preference-profile-form.factory';

@Component({
  selector: 'app-preference-profile-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './preference-profile-form.component.html',
  styleUrl: './preference-profile-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferenceProfileFormComponent {
  readonly profile = input<PreferenceProfile | null>(null);
  readonly capabilities = input<PreferencesCapabilitySnapshot | null>(null);
  readonly saving = input<boolean>(false);

  readonly saveProfile = output<PreferenceProfile>();

  readonly relationshipIntentOptions = RELATIONSHIP_INTENT_OPTIONS;
  readonly genderInterestOptions = GENDER_INTEREST_OPTIONS;
  readonly sexualPracticeOptions = SEXUAL_PRACTICE_OPTIONS;
  readonly bodyPreferenceOptions = BODY_PREFERENCE_OPTIONS;
  readonly discoveryModeOptions = DISCOVERY_MODE_OPTIONS;

  private readonly fb = new FormBuilder();

  readonly form = buildPreferenceProfileForm(this.fb);

  readonly canEdit = computed(
    () => this.capabilities()?.canEditCorePreferences ?? false
  );

  readonly canEditAdvanced = computed(
    () => this.capabilities()?.canEditAdvancedPreferences ?? false
  );

  readonly canUseDiscreetMode = computed(
    () => this.capabilities()?.canUseDiscreetMode ?? false
  );

  readonly canUsePriorityVisibility = computed(
    () => this.capabilities()?.canUsePriorityVisibility ?? false
  );

  readonly currentPlanLabel = computed(
    () => this.capabilities()?.currentPlanLabel ?? 'Sem sessão'
  );

  constructor() {
    effect(() => {
      const profile = this.profile() ?? createEmptyPreferenceProfile('');
      this.form.patchValue(mapPreferenceProfileToFormValue(profile), {
        emitEvent: false,
      });
    });

    effect(() => {
      if (!this.canEdit()) {
        this.form.disable({ emitEvent: false });
        return;
      }

      this.form.enable({ emitEvent: false });

      this.setFlagGroupDisabled(
        'sp',
        this.sexualPracticeOptions,
        !this.canEditAdvanced()
      );
      this.setFlagGroupDisabled(
        'bp',
        this.bodyPreferenceOptions,
        !this.canEditAdvanced()
      );

      const currentMode = this.form.controls['discoveryMode']?.value;

      if (currentMode === 'discreet' && !this.canUseDiscreetMode()) {
        this.form.controls['discoveryMode']?.setValue('standard', {
          emitEvent: false,
        });
      }

      if (currentMode === 'priority' && !this.canUsePriorityVisibility()) {
        this.form.controls['discoveryMode']?.setValue('standard', {
          emitEvent: false,
        });
      }
    });
  }

  submit(): void {
    if (!this.canEdit() || this.saving() || this.form.invalid) return;

    const current = this.profile() ?? createEmptyPreferenceProfile('');
    const result = mapFormValueToPreferenceProfile(
      this.form.getRawValue(),
      current,
      this.capabilities()
    );

    this.saveProfile.emit(result);
  }

  isModeAvailable(mode: string): boolean {
    if (mode === 'discreet') return this.canUseDiscreetMode();
    if (mode === 'priority') return this.canUsePriorityVisibility();
    return true;
  }

  modeRequirement(mode: string): string {
    if (mode === 'discreet' && !this.canUseDiscreetMode()) {
      return ' — Premium';
    }

    if (mode === 'priority' && !this.canUsePriorityVisibility()) {
      return ' — VIP';
    }

    return '';
  }

  selectedCount(
    prefix: string,
    options: ReadonlyArray<{ key: string }>
  ): number {
    return options.reduce((total, option) => {
      return total + (this.form.get(`${prefix}_${option.key}`)?.value === true ? 1 : 0);
    }, 0);
  }

  selectionLabel(count: number): string {
    if (count === 0) return 'Nenhuma seleção';
    if (count === 1) return '1 selecionada';
    return `${count} selecionadas`;
  }

  private setFlagGroupDisabled(
    prefix: string,
    options: ReadonlyArray<{ key: string }>,
    disabled: boolean
  ): void {
    for (const option of options) {
      const control = this.form.get(`${prefix}_${option.key}`);
      if (!control) continue;

      if (disabled) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    }
  }
}
