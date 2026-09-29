// src/app/preferences/components/preference-summary-card/preference-summary-card.component.ts
// Card-resumo do domínio novo de preferências.
//
// Objetivo:
// - exibir rapidamente o estado atual do domínio de preferências
// - servir tanto para página interna futura quanto para dashboards
// - desacoplar apresentação da fachada/application
//
// Observação:
// - componente somente visual
// - não salva nada
// - não conhece legado
// Visua clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PreferencesViewModel } from '../../application/preferences.facade';
import {
  GENDER_INTEREST_OPTIONS,
  RELATIONSHIP_INTENT_OPTIONS,
  SEXUAL_PRACTICE_OPTIONS,
} from '../../catalogs/preference-profile-options.catalog';

@Component({
  selector: 'app-preference-summary-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preference-summary-card.component.html',
  styleUrl: './preference-summary-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferenceSummaryCardComponent {
  readonly vm = input<PreferencesViewModel | null>(null);

  readonly relationshipIntentSummary = computed(() =>
    this.selectionSummary(
      this.vm()?.profile?.relationshipIntents ?? [],
      RELATIONSHIP_INTENT_OPTIONS
    )
  );

  readonly acceptedGendersSummary = computed(() =>
    this.selectionSummary(
      this.vm()?.profile?.hardRules?.acceptedGenders ?? [],
      GENDER_INTEREST_OPTIONS
    )
  );

  readonly practicesSummary = computed(() =>
    this.selectionSummary(
      this.vm()?.profile?.softRules?.sexualPractices ?? [],
      SEXUAL_PRACTICE_OPTIONS
    )
  );

  readonly currentModeLabel = computed(() => {
    const mode = this.vm()?.intent?.mode ?? 'inactive';

    switch (mode) {
      case 'chat':
        return 'Conversar';
      case 'meet_today':
        return 'Encontrar hoje';
      case 'casual':
        return 'Casual';
      case 'dating':
        return 'Dating';
      case 'serious':
        return 'Sério';
      case 'fetish':
        return 'Fetiche';
      case 'travel':
        return 'Viagem';
      case 'inactive':
      default:
        return 'Inativo';
    }
  });

  readonly discoveryModeLabel = computed(() => {
    const mode = this.vm()?.profile?.visibility?.discoveryMode ?? 'standard';

    switch (mode) {
      case 'discreet':
        return 'Discreto';
      case 'priority':
        return 'Prioritário';
      case 'standard':
      default:
        return 'Padrão';
    }
  });

  readonly availableNowLabel = computed(() =>
    this.vm()?.intent?.availableNow ? 'Disponível agora' : 'Não disponível agora'
  );

  private selectionSummary(
    selected: readonly string[],
    options: readonly { key: string; label: string }[]
  ): string {
    const selectedSet = new Set(selected ?? []);
    const labels = options
      .filter((option) => selectedSet.has(option.key))
      .map((option) => option.label);

    if (!labels.length) {
      return 'Nenhuma seleção';
    }

    const visible = labels.slice(0, 3);
    const remaining = labels.length - visible.length;

    return remaining > 0
      ? `${visible.join(' · ')} +${remaining}`
      : visible.join(' · ');
  }
}