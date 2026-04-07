// src/app/preferences/components/intent-state-form/intent-state-form.component.ts
// Formulário inédito para edição da intenção contextual.
// Não conhece legado.
// Não persiste diretamente.
// Emite IntentState pronto para a página/facade salvar.
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { IntentState } from '../../models/intent-state.model';
import { IntentMode } from '../../models/preference.types';
import { createEmptyIntentState } from '../../utils/preference-normalizers';
import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';

type IntentOption = {
  key: IntentMode;
  label: string;
};

@Component({
  selector: 'app-intent-state-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
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
    { key: 'dating', label: 'Dating' },
    { key: 'serious', label: 'Sério' },
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

  constructor() {
    effect(() => {
      const intent = this.intent() ?? createEmptyIntentState('');
      this.patchForm(intent);
    });
  }

  submit(): void {
    const current = this.intent() ?? createEmptyIntentState('');

    const result: IntentState = {
      userId: current.userId,
      mode: this.form.controls.mode.value,
      availableNow: this.form.controls.availableNow.value,
      availableToday: this.form.controls.availableToday.value,
      cityOverride: this.normalizeOptionalString(this.form.controls.cityOverride.value),
      expiresAt: this.toEpochOrNull(this.form.controls.expiresAt.value),
      tags: this.parseTags(this.form.controls.tagsText.value),
      updatedAt: Date.now(),
    };

    this.saveIntent.emit(result);
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
} // Linha 140. fim do intent-state-form.component.ts