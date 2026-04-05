// src/app/preferences/components/preference-profile-form/preference-profile-form.component.ts
// Formulário visual do domínio novo.
//
// Ajuste desta versão:
// - componente deixa de carregar catálogos inline
// - componente deixa de serializar o model sozinho
// - componente passa a focar em interação/UX
//
// Responsabilidade:
// - renderizar o formulário
// - aplicar gating de edição
// - emitir o model pronto para a página/facade salvar
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

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
  imports: [CommonModule, ReactiveFormsModule],
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
    () => this.capabilities()?.canEditAdvancedPreferences ?? false
  );

  readonly canUseDiscreetMode = computed(
    () => this.capabilities()?.canUseDiscreetMode ?? false
  );

  readonly canUsePriorityVisibility = computed(
    () => this.capabilities()?.canUsePriorityVisibility ?? false
  );

  constructor() {
    effect(() => {
      const profile = this.profile() ?? createEmptyPreferenceProfile('');
      this.form.patchValue(mapPreferenceProfileToFormValue(profile), { emitEvent: false });
    });

    effect(() => {
      const canEdit = this.canEdit();
      const canUseDiscreet = this.canUseDiscreetMode();
      const canUsePriority = this.canUsePriorityVisibility();

      if (!canEdit) {
        this.form.disable({ emitEvent: false });
        return;
      }

      this.form.enable({ emitEvent: false });

      const currentMode = this.form.controls['discoveryMode']?.value;

      if (currentMode === 'discreet' && !canUseDiscreet) {
        this.form.controls['discoveryMode']?.setValue('standard', { emitEvent: false });
      }

      if (currentMode === 'priority' && !canUsePriority) {
        this.form.controls['discoveryMode']?.setValue('standard', { emitEvent: false });
      }
    });
  }

  submit(): void {
    if (!this.canEdit()) return;
    if (this.form.invalid) return;

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
} // Linha 124, fim do preference-profile-form.component.ts