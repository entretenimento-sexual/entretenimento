// src/app/preferences/components/preference-profile-form/preference-profile-form.component.ts
// -----------------------------------------------------------------------------
// FORMULÁRIO DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// Responsabilidade:
// - renderizar preferências essenciais com navegação progressiva;
// - aplicar limitações por assinatura sem esconder recursos de segurança;
// - permitir que o usuário escolha entre preferir e exigir;
// - preservar seleções pagas existentes quando o entitlement não está ativo;
// - emitir o model normalizado para a página/facade salvar;
// - expor estado dirty/pristine para proteção de navegação.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { FormValidationFocusDirective } from '../../../shared/form-validation-focus/form-validation-focus.directive';
import type { PreferenceProfile } from '../../models/preference-profile.model';
import type { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';
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

type NumericPreferenceControl = 'minAge' | 'maxAge' | 'maxDistanceKm';

@Component({
  selector: 'app-preference-profile-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    FormValidationFocusDirective,
  ],
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
  private readonly destroyRef = inject(DestroyRef);
  readonly hasPendingChanges = signal(false);

  readonly form = buildPreferenceProfileForm(this.fb);

  readonly canEdit = computed(
    () => this.capabilities()?.canEditCorePreferences ?? false
  );

  readonly canEditAdvanced = computed(
    () => this.capabilities()?.canEditAdvancedPreferences ?? false
  );

  readonly canRequireAdvanced = computed(
    () => this.capabilities()?.canRequireAdvancedPreferences ?? false
  );

  readonly canUseDiscreetMode = computed(
    () => this.capabilities()?.canUseDiscreetMode ?? false
  );

  readonly canUsePriorityVisibility = computed(
    () => this.capabilities()?.canUsePriorityVisibility ?? false
  );

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.hasPendingChanges.set(true));
    effect(() => {
      const profile = this.profile() ?? createEmptyPreferenceProfile('');
      this.form.patchValue(mapPreferenceProfileToFormValue(profile), {
        emitEvent: false,
      });
      this.markSaved();
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
      this.setControlDisabled(
        'sexualPracticeMode',
        !this.canEditAdvanced()
      );
      this.setControlDisabled(
        'bodyPreferenceMode',
        !this.canEditAdvanced()
      );

      if (!this.canRequireAdvanced()) {
        this.forceAdvancedModeToPrefer('sexualPracticeMode');
        this.forceAdvancedModeToPrefer('bodyPreferenceMode');
      }

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
    if (!this.canEdit() || this.saving()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (!this.hasPendingChanges()) return;

    const current = this.profile() ?? createEmptyPreferenceProfile('');
    const result = mapFormValueToPreferenceProfile(
      this.form.getRawValue(),
      current,
      this.capabilities()
    );

    this.saveProfile.emit(result);
  }

  hasUnsavedChanges(): boolean {
    return this.hasPendingChanges();
  }

  markSaved(): void {
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.hasPendingChanges.set(false);
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

  advancedRequirementLabel(): string {
    return this.canRequireAdvanced() ? 'Exigir' : 'Exigir — Premium';
  }

  selectedCount(
    prefix: string,
    options: ReadonlyArray<{ key: string }>
  ): number {
    return options.reduce((total, option) => {
      return total +
        (this.form.get(`${prefix}_${option.key}`)?.value === true ? 1 : 0);
    }, 0);
  }

  selectionLabel(count: number): string {
    if (count === 0) return 'Nenhuma seleção';
    if (count === 1) return '1 selecionada';
    return `${count} selecionadas`;
  }

  reachSummary(): string {
    const minAge = Number(this.form.controls['minAge']?.value ?? 18);
    const maxAge = Number(this.form.controls['maxAge']?.value ?? 100);
    const maxDistanceKm = Number(this.form.controls['maxDistanceKm']?.value ?? 0);

    if (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0) {
      return `${minAge}–${maxAge} anos`;
    }

    return `${minAge}–${maxAge} anos · até ${maxDistanceKm} km`;
  }

  visibilitySummary(): string {
    const mode = String(this.form.controls['discoveryMode']?.value ?? 'standard');
    const label = this.discoveryModeOptions.find((option) => option.key === mode)?.label;

    return label || 'Padrão';
  }

  selfDescriptionSummary(): string {
    return this.selectionLabel(
      this.selectedCount('st', this.bodyPreferenceOptions)
    );
  }

  advancedSummary(): string {
    if (!this.canEditAdvanced()) return 'Opcional';

    const count =
      this.selectedCount('sp', this.sexualPracticeOptions) +
      this.selectedCount('bp', this.bodyPreferenceOptions);

    return this.selectionLabel(count);
  }

  numericFieldError(controlName: NumericPreferenceControl): string | null {
    const control = this.form.get(controlName);
    if (!control?.touched || !control.invalid) return null;

    if (controlName === 'maxDistanceKm') {
      if (control.hasError('min') || control.hasError('max')) {
        return 'Informe uma distância entre 1 e 500 km.';
      }
      return 'Revise a distância informada.';
    }

    if (control.hasError('min') || control.hasError('max')) {
      return 'Informe uma idade entre 18 e 100 anos.';
    }

    return 'Revise a idade informada.';
  }

  ageRangeInvalid(): boolean {
    return (
      this.form.hasError('ageRangeOrder') &&
      (this.form.controls['minAge']?.touched ||
        this.form.controls['maxAge']?.touched)
    );
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

  private setControlDisabled(controlName: string, disabled: boolean): void {
    const control = this.form.get(controlName);
    if (!control) return;

    if (disabled) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  }

  private forceAdvancedModeToPrefer(controlName: string): void {
    const control = this.form.get(controlName);
    if (control?.value !== 'require') return;

    control.setValue('prefer', { emitEvent: false });
  }
}
