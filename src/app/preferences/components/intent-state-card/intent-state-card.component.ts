// src/app/preferences/components/intent-state-card/intent-state-card.component.ts
// Card visual para exibir o estado contextual da intenção do usuário.
// Não salva nada.
// Não conhece legado.
// Serve como bloco reutilizável em páginas futuras do domínio preferences.

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { IntentState } from '../../models/intent-state.model';

@Component({
  selector: 'app-intent-state-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './intent-state-card.component.html',
  styleUrl: './intent-state-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntentStateCardComponent {
  readonly intent = input<IntentState | null>(null);

  readonly modeLabel = computed(() => {
    const mode = this.intent()?.mode ?? 'inactive';

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

  readonly availabilityLabel = computed(() => {
    const current = this.intent();
    if (!current) return 'Sem disponibilidade definida';

    if (current.availableNow) return 'Disponível agora';
    if (current.availableToday) return 'Disponível hoje';
    return 'Sem disponibilidade imediata';
  });

  readonly hasTags = computed(() => (this.intent()?.tags?.length ?? 0) > 0);
}