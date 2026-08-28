// src/app/preferences/components/intent-state-form/intent-state-form.component.ts
// -----------------------------------------------------------------------------
// FORMULÁRIO DE DISPONIBILIDADE ATUAL
// -----------------------------------------------------------------------------
// - disponibilidade básica permanece acessível a toda conta autenticada;
// - cidade contextual, expiração e tags exigem assinatura Básica ou superior;
// - a projeção canônica da assinatura chega por capabilities;
// - o componente não persiste diretamente;
// - expõe estado dirty/pristine para proteção de navegação.
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

import { IntentState } from '../../models/intent-state.model';
import { IntentMode } from '../../models/preference.types';
import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';
import { createEmptyIntentState } from '../../utils/preference-normalizers';

type IntentOption = {
  key: IntentMode;
  label: string;
};

@Component({
  selector: 'app-intent-state-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './intent-state-form.component.html',
  styleUrl: './intent-state-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntentStateFormComponent {
  readonly intent = input<IntentState | null>(null);
  readonly capabilities = input<PreferencesCapabilitySnapshot | null>(null);
  readonly saving = input<boolean>(false);

  readonly saveIntent = output<IntentState>();

  readonly intentOptions: IntentOption[] = [
    { key: 'inactive', label: 'Inativo' },
    { key: 'chat', label: 'Conversar' },
    { key: 'meet_today', label: 'Encontrar hoje' },
    { key: 'casual', label: 'Casual' },
    { key: 'dating', label: 'Namoro' },
    { key: 'serious', label: 'Relacionamento sério' },
    { key: 'fetish', label: 'Fetiche' },
    { key: 'travel', label: 'Viagem' },
  ];

  private readonly fb = new FormBuilder();

  readonly form = this.fb.nonNullable.group({
    mode: this.fb.nonNullable.control<IntentMode>('inactive'),
    availableNow: false,
    availableToday: false,
    cityOverride: '',
    expiresAt: '',
    tagsText: '',
  });

  readonly canEdit = computed(
    () => this.capabilities()?.canEditIntentState ?? false
  );

  readonly canUseContextualIntent = computed(
    () => this.capabilities()?.canUseContextualIntent ?? false
  );

  readonly currentPlanLabel = computed(
    () => this.capabilities()?.currentPlanLabel ?? 'Sem sessão'
  );

  constructor() {
    effect(() => {
      const intent = this.intent() ?? createEmptyIntentState('');
      this.patchForm(intent);
    });

    effect(() => {
      if (!this.canEdit()) {
        this.form.disable({ emitEvent: false });
        return;
      }

      this.form.enable({ emitEvent: false });
      this.setContextualControlsDisabled(!this.canUseContextualIntent());
    });
  }

  submit(): void {
    if (
      !this.canEdit() ||
      this.saving() ||
      this.form.invalid ||
      this.form.pristine
    ) {
      return;
    }

    const current = this.intent() ?? createEmptyIntentState('');
    const canUseContext = this.canUseContextualIntent();

    const result: IntentState = {
      userId: current.userId,
      mode: this.form.controls.mode.value,
      availableNow: this.form.controls.availableNow.value,
      availableToday: this.form.controls.availableToday.value,
      // Benefícios contextuais deixam de ser publicados quando o entitlement
      // não está ativo. O usuário continua podendo usar a disponibilidade básica.
      cityOverride: canUseContext
        ? this.normalizeOptionalString(this.form.controls.cityOverride.value)
        : null,
      expiresAt: canUseContext
        ? this.toEpochOrNull(this.form.controls.expiresAt.value)
        : null,
      tags: canUseContext
        ? this.parseTags(this.form.controls.tagsText.value)
        : [],
      updatedAt: Date.now(),
    };

    this.saveIntent.emit(result);
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  markSaved(): void {
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private patchForm(intent: IntentState): void {
    this.form.patchValue(
      {
        mode: intent.mode,
        availableNow: intent.availableNow,
        availableToday: intent.availableToday,
        cityOverride: intent.cityOverride ?? '',
        expiresAt: this.fromEpochToDatetimeLocal(intent.expiresAt),
        tagsText: (intent.tags ?? []).join(', '),
      },
      { emitEvent: false }
    );
    this.markSaved();
  }

  private setContextualControlsDisabled(disabled: boolean): void {
    const controls = [
      this.form.controls.cityOverride,
      this.form.controls.expiresAt,
      this.form.controls.tagsText,
    ];

    for (const control of controls) {
      if (disabled) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    }
  }

  private parseTags(raw: string): string[] {
    return Array.from(
      new Set(
        (raw ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    );
  }

  private normalizeOptionalString(value: string): string | null {
    const normalized = (value ?? '').trim();
    return normalized || null;
  }

  private toEpochOrNull(value: string): number | null {
    const raw = (value ?? '').trim();
    if (!raw) return null;

    const date = new Date(raw);
    const time = date.getTime();

    return Number.isFinite(time) ? time : null;
  }

  private fromEpochToDatetimeLocal(value: number | null | undefined): string {
    if (!value) return '';

    const date = new Date(value);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
