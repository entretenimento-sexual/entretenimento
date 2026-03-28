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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PreferencesViewModel } from '../../application/preferences.facade';

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

  readonly relationshipIntentCount = computed(
    () => this.vm()?.profile?.relationshipIntents?.length ?? 0
  );

  readonly acceptedGendersCount = computed(
    () => this.vm()?.profile?.hardRules?.acceptedGenders?.length ?? 0
  );

  readonly practicesCount = computed(
    () => this.vm()?.profile?.softRules?.sexualPractices?.length ?? 0
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
}